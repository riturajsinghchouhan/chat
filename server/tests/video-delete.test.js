import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startStack, registerUser, auth, uuid, connected, waitFor, directConversation } from './helpers.js';

const CHUNK = 64 * 1024; // UPLOAD_CHUNK_BYTES in tests/setup.js

let stack;
let alice;
let bob;
let eve;
let conv;
let video;
let poster;

// Minimal MP4 signature ("ftyp isom") followed by filler; enough for content sniffing.
function fakeMp4(size) {
  const buf = Buffer.alloc(size);
  Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex').copy(buf);
  for (let i = 24; i < size; i += 1) buf[i] = i % 251;
  return buf;
}

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  stack = await startStack();
  alice = await registerUser(stack.app);
  bob = await registerUser(stack.app);
  eve = await registerUser(stack.app);
  conv = await directConversation(stack.app, alice, bob);
  video = fakeMp4(CHUNK * 2 + 1234); // 3 chunks, the last one short
  poster = await sharp({ create: { width: 90, height: 160, channels: 3, background: '#223344' } }).jpeg().toBuffer();
});
afterAll(async () => {
  await stack.stop();
});

const init = (user, body = {}) =>
  request(stack.app)
    .post('/api/media/uploads')
    .set(auth(user.token))
    .send({ conversationId: conv._id, fileName: 'snap.mp4', size: video.length, duration: 12.4, ...body });

const putChunk = (user, uploadId, index, data) =>
  request(stack.app)
    .put(`/api/media/uploads/${uploadId}/chunks/${index}`)
    .set(auth(user.token))
    .set('Content-Type', 'application/octet-stream')
    .send(data);

const chunkOf = (i) => video.subarray(i * CHUNK, Math.min(video.length, (i + 1) * CHUNK));

async function uploadVideo(user) {
  const { body } = await init(user).expect(201);
  for (let i = 0; i < body.totalChunks; i += 1) await putChunk(user, body.uploadId, i, chunkOf(i)).expect(200);
  const done = await request(stack.app)
    .post(`/api/media/uploads/${body.uploadId}/complete`)
    .set(auth(user.token))
    .attach('poster', poster, 'poster.jpg')
    .expect(201);
  return done.body.media;
}

const sendVideo = (user, media, extra = {}) =>
  request(stack.app)
    .post('/api/messages')
    .set(auth(user.token))
    .send({ clientId: uuid(), conversationId: conv._id, type: 'video', mediaId: media.mediaId, ...extra });

const sendText = (user, text) =>
  request(stack.app).post('/api/messages').set(auth(user.token)).send({ clientId: uuid(), conversationId: conv._id, type: 'text', text });

describe('chunked video uploads', () => {
  it('accepts chunks in any order, retries, and resumes', async () => {
    const { body: session } = await init(alice).expect(201);
    expect(session.totalChunks).toBe(3);
    expect(session.chunkSize).toBe(CHUNK);

    await putChunk(alice, session.uploadId, 2, chunkOf(2)).expect(200);
    await putChunk(alice, session.uploadId, 0, chunkOf(0)).expect(200);
    // Wrong chunk size is rejected
    expect((await putChunk(alice, session.uploadId, 1, chunkOf(2))).status).toBe(400);
    // Other users cannot touch the session
    expect((await putChunk(bob, session.uploadId, 1, chunkOf(1))).status).toBe(404);

    const status = await request(stack.app).get(`/api/media/uploads/${session.uploadId}`).set(auth(alice.token)).expect(200);
    expect(status.body.received).toEqual([0, 2]);
    const early = await request(stack.app).post(`/api/media/uploads/${session.uploadId}/complete`).set(auth(alice.token));
    expect(early.status).toBe(409);

    await putChunk(alice, session.uploadId, 1, chunkOf(1)).expect(200);
    await putChunk(alice, session.uploadId, 1, chunkOf(1)).expect(200); // duplicate retry is harmless
    const done = await request(stack.app)
      .post(`/api/media/uploads/${session.uploadId}/complete`)
      .set(auth(alice.token))
      .attach('poster', poster, 'poster.jpg')
      .expect(201);
    expect(done.body.media).toMatchObject({ type: 'video', mimeType: 'video/mp4', fileSize: video.length, duration: 12.4, width: 90, height: 160 });
    expect(done.body.media.thumbnailUrl).toMatch(/^\/api\/media\//);

    // A retried "complete" returns the same file
    const again = await request(stack.app).post(`/api/media/uploads/${session.uploadId}/complete`).set(auth(alice.token)).expect(200);
    expect(again.body.media.mediaId).toBe(done.body.media.mediaId);

    const full = await request(stack.app).get(done.body.media.mediaUrl).set(auth(alice.token)).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(full.body, video)).toBe(0);
  });

  it('rejects non-video content, long clips and oversized files', async () => {
    const { body: session } = await init(alice).expect(201);
    const fake = Buffer.alloc(CHUNK, 0x41);
    expect((await putChunk(alice, session.uploadId, 0, fake)).status).toBe(415);
    expect((await request(stack.app).get(`/api/media/uploads/${session.uploadId}`).set(auth(alice.token))).status).toBe(404);

    expect((await init(alice, { duration: 45 })).status).toBe(400);
    expect((await init(alice, { size: 60 * 1024 * 1024 })).status).toBe(413);
    expect((await init(eve)).status).toBe(404); // not a member of the conversation
  });

  it('sends a video message and streams it with Range requests and signed links', async () => {
    const media = await uploadVideo(alice);
    const b = stack.connect(bob.token);
    await connected(b);
    const incoming = waitFor(b, 'message:new');
    const sent = await sendVideo(alice, media, { text: 'snap!' }).expect(201);
    const { message } = await incoming;
    b.close();
    expect(message).toMatchObject({ type: 'video', text: 'snap!', duration: 12.4, mimeType: 'video/mp4' });
    expect(sent.body.message.thumbnailUrl).toBeTruthy();

    const part = await request(stack.app)
      .get(message.mediaUrl)
      .set(auth(bob.token))
      .set('Range', 'bytes=70000-')
      .buffer(true)
      .parse(binary)
      .expect(206);
    expect(part.headers['content-range']).toBe(`bytes 70000-${video.length - 1}/${video.length}`);
    expect(part.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(part.body, video.subarray(70000))).toBe(0);

    const head = await request(stack.app).get(message.mediaUrl).set(auth(bob.token)).set('Range', 'bytes=0-99').buffer(true).parse(binary).expect(206);
    expect(head.body.length).toBe(100);
    expect((await request(stack.app).get(message.mediaUrl).set(auth(bob.token)).set('Range', 'bytes=999999999-')).status).toBe(416);

    // Signed link: works without an Authorization header (as <video src> needs)
    const link = await request(stack.app).get(`${message.mediaUrl}/link`).set(auth(bob.token)).expect(200);
    const viaLink = await request(stack.app).get(link.body.url).set('Range', 'bytes=0-9').buffer(true).parse(binary).expect(206);
    expect(Buffer.compare(viaLink.body, video.subarray(0, 10))).toBe(0);
    expect((await request(stack.app).get(link.body.url.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(401);
    expect((await request(stack.app).get(`${message.mediaUrl}/link`).set(auth(eve.token))).status).toBe(404);
  });
});

describe('deleting multiple messages', () => {
  it('deletes several messages for me only', async () => {
    const ids = [];
    for (const t of ['one', 'two', 'three']) ids.push((await sendText(alice, t)).body.message._id);
    const b = stack.connect(bob.token);
    await connected(b);
    const hidden = waitFor(b, 'message:hidden');
    await request(stack.app)
      .post('/api/messages/bulk-delete')
      .set(auth(bob.token))
      .send({ conversationId: conv._id, messageIds: ids, scope: 'me' })
      .expect(200);
    expect((await hidden).messageIds.sort()).toEqual([...ids].sort());
    b.close();

    const bobView = await request(stack.app).get(`/api/messages/${conv._id}?limit=100`).set(auth(bob.token));
    const aliceView = await request(stack.app).get(`/api/messages/${conv._id}?limit=100`).set(auth(alice.token));
    expect(bobView.body.messages.filter((m) => ids.includes(m._id))).toHaveLength(0);
    expect(aliceView.body.messages.filter((m) => ids.includes(m._id))).toHaveLength(3);
  });

  it('deletes several own messages for everyone, all-or-nothing', async () => {
    const mine1 = (await sendText(alice, 'oops 1')).body.message._id;
    const mine2 = (await sendText(alice, 'oops 2')).body.message._id;
    const theirs = (await sendText(bob, 'not yours')).body.message._id;

    const refused = await request(stack.app)
      .post('/api/messages/bulk-delete')
      .set(auth(alice.token))
      .send({ conversationId: conv._id, messageIds: [mine1, theirs], scope: 'everyone' });
    expect(refused.status).toBe(403);
    const check = await request(stack.app).get(`/api/messages/item/${mine1}`).set(auth(alice.token));
    expect(check.body.message.deletedAt).toBeFalsy();

    const b = stack.connect(bob.token);
    await connected(b);
    const updated = waitFor(b, 'messages:updated');
    const res = await request(stack.app)
      .post('/api/messages/bulk-delete')
      .set(auth(alice.token))
      .send({ conversationId: conv._id, messageIds: [mine1, mine2], scope: 'everyone' })
      .expect(200);
    expect(res.body.messages.every((m) => m.deletedAt && m.text === '')).toBe(true);
    expect((await updated).messages).toHaveLength(2);
    b.close();

    // Messages from another conversation (or unknown ids) are rejected
    const other = await directConversation(stack.app, alice, eve);
    expect(
      (await request(stack.app).post('/api/messages/bulk-delete').set(auth(alice.token)).send({ conversationId: other._id, messageIds: [mine1], scope: 'me' })).status,
    ).toBe(404);
  });

  it('removes the stored video when it is deleted for everyone', async () => {
    const media = await uploadVideo(alice);
    const { body } = await sendVideo(alice, media).expect(201);
    await request(stack.app)
      .post('/api/messages/bulk-delete')
      .set(auth(alice.token))
      .send({ conversationId: conv._id, messageIds: [body.message._id], scope: 'everyone' })
      .expect(200);
    expect((await request(stack.app).get(media.mediaUrl).set(auth(alice.token))).status).toBe(404);
  });
});
