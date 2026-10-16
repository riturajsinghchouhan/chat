import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startStack, registerUser, auth, uuid, connected, waitFor, directConversation } from './helpers.js';

let stack;
let alice;
let bob;
let eve;
let conv;
let png;

beforeAll(async () => {
  stack = await startStack();
  alice = await registerUser(stack.app);
  bob = await registerUser(stack.app);
  eve = await registerUser(stack.app);
  conv = await directConversation(stack.app, alice, bob);
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e5484d' } }).png().toBuffer();
});
afterAll(async () => {
  await stack.stop();
});

const upload = (user, buffer, filename, conversationId = conv._id) =>
  request(stack.app)
    .post('/api/media/upload')
    .set(auth(user.token))
    .field('conversationId', conversationId)
    .attach('file', buffer, filename);

describe('media uploads (GridFS)', () => {
  it('uploads an image (e.g. a camera capture), sends it and restricts access', async () => {
    const up = await upload(alice, png, 'capture.png');
    expect(up.status).toBe(201);
    expect(up.body.media.type).toBe('image');
    expect(up.body.media.width).toBe(64);
    expect(up.body.media.thumbnailUrl).toMatch(/^\/api\/media\//);

    // Before it is attached to a message only the uploader can read it
    expect((await request(stack.app).get(up.body.media.mediaUrl).set(auth(bob.token))).status).toBe(404);
    expect((await request(stack.app).get(up.body.media.mediaUrl).set(auth(alice.token))).status).toBe(200);

    const b = stack.connect(bob.token);
    await connected(b);
    const incoming = waitFor(b, 'message:new');
    const send = await request(stack.app)
      .post('/api/messages')
      .set(auth(alice.token))
      .send({ clientId: uuid(), conversationId: conv._id, type: 'image', mediaId: up.body.media.mediaId, text: 'look' });
    expect(send.status).toBe(201);
    const { message } = await incoming;
    expect(message.type).toBe('image');
    expect(message.text).toBe('look');
    b.close();

    const asBob = await request(stack.app).get(message.mediaUrl).set(auth(bob.token));
    expect(asBob.status).toBe(200);
    expect(asBob.headers['content-type']).toBe('image/png');
    expect((await request(stack.app).get(message.mediaUrl).set(auth(eve.token))).status).toBe(404);
    expect((await request(stack.app).get(message.mediaUrl)).status).toBe(401);
  });

  it('rejects files whose content does not match an allowed type', async () => {
    const fake = await upload(alice, Buffer.from('MZ\x90\x00 definitely an exe'), 'photo.png');
    expect(fake.status).toBe(415);
    const script = await upload(alice, Buffer.from('<script>alert(1)</script>'), 'x.html');
    expect(script.status).toBe(415);
  });

  it('accepts documents, and rejects uploads into foreign conversations', async () => {
    const txt = await upload(alice, Buffer.from('hello,world\n1,2'), 'data.csv');
    expect(txt.status).toBe(201);
    expect(txt.body.media.type).toBe('file');
    expect((await upload(eve, png, 'a.png')).status).toBe(404);
  });

  it('will not let another user send someone else\'s upload', async () => {
    const up = await upload(alice, png, 'mine.png');
    const res = await request(stack.app)
      .post('/api/messages')
      .set(auth(bob.token))
      .send({ clientId: uuid(), conversationId: conv._id, type: 'image', mediaId: up.body.media.mediaId });
    expect(res.status).toBe(400);
  });

  it('uploads and serves a public avatar', async () => {
    const res = await request(stack.app).post('/api/users/avatar').set(auth(alice.token)).attach('avatar', png, 'me.png');
    expect(res.status).toBe(200);
    const img = await request(stack.app).get(res.body.user.avatar);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
  });
});

describe('groups', () => {
  let group;

  it('creates a group with the creator as admin', async () => {
    const res = await request(stack.app)
      .post('/api/groups')
      .set(auth(alice.token))
      .send({ name: 'Weekend', description: 'plans', memberIds: [bob.user._id] });
    expect(res.status).toBe(201);
    group = res.body.conversation;
    expect(group.me.role).toBe('admin');
    expect(group.members).toHaveLength(2);
    expect(group.lastMessage.type).toBe('system');
  });

  it('enforces admin permissions', async () => {
    const add = await request(stack.app).post(`/api/groups/${group._id}/members`).set(auth(bob.token)).send({ userIds: [eve.user._id] });
    expect(add.status).toBe(403);
    const rename = await request(stack.app).patch(`/api/groups/${group._id}`).set(auth(bob.token)).send({ name: 'Mine' });
    expect(rename.status).toBe(403);
    const ok = await request(stack.app).post(`/api/groups/${group._id}/members`).set(auth(alice.token)).send({ userIds: [eve.user._id] });
    expect(ok.status).toBe(200);
    expect(ok.body.conversation.members).toHaveLength(3);
  });

  it('lets members message, honours admins-only mode, and removes members', async () => {
    const msg = (user) =>
      request(stack.app).post('/api/messages').set(auth(user.token)).send({ clientId: uuid(), conversationId: group._id, type: 'text', text: 'hey all' });
    expect((await msg(eve)).status).toBe(201);

    await request(stack.app).patch(`/api/groups/${group._id}`).set(auth(alice.token)).send({ adminsOnlyMessages: true }).expect(200);
    expect((await msg(eve)).status).toBe(403);
    expect((await msg(alice)).status).toBe(201);

    await request(stack.app).delete(`/api/groups/${group._id}/members/${eve.user._id}`).set(auth(alice.token)).expect(200);
    expect((await request(stack.app).get(`/api/messages/${group._id}`).set(auth(eve.token))).status).toBe(404);
    const notes = await request(stack.app).get('/api/notifications').set(auth(eve.token));
    expect(notes.body.notifications.map((n) => n.type)).toEqual(expect.arrayContaining(['group_added', 'group_removed']));
  });

  it('promotes a new admin when the last admin leaves', async () => {
    await request(stack.app).delete(`/api/groups/${group._id}/members/${alice.user._id}`).set(auth(alice.token)).expect(200);
    const res = await request(stack.app).get(`/api/groups/${group._id}`).set(auth(bob.token));
    expect(res.body.conversation.me.role).toBe('admin');
  });
});
