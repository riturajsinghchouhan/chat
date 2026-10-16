import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startStack, registerUser, auth, waitFor, connected, directConversation } from './helpers.js';

let stack;
let alice;
let bob;
let eve;
let conv;
let jpeg;

beforeAll(async () => {
  stack = await startStack();
  alice = await registerUser(stack.app);
  bob = await registerUser(stack.app);
  eve = await registerUser(stack.app);
  conv = await directConversation(stack.app, alice, bob);
  jpeg = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#335577' } }).jpeg().toBuffer();
});
afterAll(async () => {
  await stack.stop();
});

const view = (socket, conversationId) => socket.timeout(5000).emitWithAck('chat:view', { conversationId });
const noEvent = (socket, event, ms = 300) =>
  new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`unexpected ${event}`));
    socket.once(event, fail);
    setTimeout(() => {
      socket.off(event, fail);
      resolve();
    }, ms);
  });

describe('chat viewing presence', () => {
  it('tells the other member who is looking at the chat, and when they leave', async () => {
    const a = stack.connect(alice.token);
    const b = stack.connect(bob.token);
    await Promise.all([connected(a), connected(b)]);

    const seen = waitFor(b, 'chat:viewing');
    const first = await view(a, conv._id);
    expect(first).toEqual({ ok: true, viewers: [] });
    expect(await seen).toEqual({ conversationId: conv._id, userId: alice.user._id, viewing: true });

    // Bob opens the chat: he learns Alice is already there
    const seenByAlice = waitFor(a, 'chat:viewing');
    expect((await view(b, conv._id)).viewers).toEqual([alice.user._id]);
    expect((await seenByAlice).viewing).toBe(true);

    // Alice leaves (tab hidden / chat closed)
    const left = waitFor(b, 'chat:viewing');
    await view(a, null);
    expect(await left).toEqual({ conversationId: conv._id, userId: alice.user._id, viewing: false });

    // Disconnecting while viewing also counts as leaving
    await view(a, conv._id);
    const gone = waitFor(b, 'chat:viewing');
    await new Promise((r) => setTimeout(r, 50));
    a.close();
    expect((await gone).viewing).toBe(false);
    b.close();
  });

  it('keeps showing a user who still has the chat open on another tab', async () => {
    const a1 = stack.connect(alice.token);
    const a2 = stack.connect(alice.token);
    const b = stack.connect(bob.token);
    await Promise.all([connected(a1), connected(a2), connected(b)]);
    await view(a1, conv._id);
    await view(a2, conv._id);
    await new Promise((r) => setTimeout(r, 100));
    const quiet = noEvent(b, 'chat:viewing');
    await view(a1, null);
    await quiet;
    expect((await view(b, conv._id)).viewers).toEqual([alice.user._id]);
    [a1, a2, b].forEach((s) => s.close());
  });

  it('shares nothing with non-members or blocked users', async () => {
    const e = stack.connect(eve.token);
    const b = stack.connect(bob.token);
    await Promise.all([connected(e), connected(b)]);
    const quiet = noEvent(b, 'chat:viewing');
    expect(await view(e, conv._id)).toEqual({ ok: true, viewers: [] });
    await quiet;
    [e, b].forEach((s) => s.close());

    const blockedConv = await directConversation(stack.app, eve, bob);
    await request(stack.app).post(`/api/users/${eve.user._id}/block`).set(auth(bob.token)).expect(200);
    const e2 = stack.connect(eve.token);
    const b2 = stack.connect(bob.token);
    await Promise.all([connected(e2), connected(b2)]);
    const quiet2 = noEvent(b2, 'chat:viewing');
    await view(e2, blockedConv._id);
    await quiet2;
    [e2, b2].forEach((s) => s.close());
  });
});

describe('chat wallpapers', () => {
  const upload = (user) => request(stack.app).post('/api/users/wallpaper').set(auth(user.token)).attach('wallpaper', jpeg, 'bg.jpg');
  const setChat = (user, wallpaper) => request(stack.app).patch(`/api/conversations/${conv._id}`).set(auth(user.token)).send({ wallpaper });

  it('sets a private per-chat wallpaper and a default for all chats', async () => {
    const preset = await setChat(alice, { kind: 'preset', value: 'sunset', dim: 20 }).expect(200);
    expect(preset.body.conversation.me.wallpaper).toMatchObject({ kind: 'preset', value: 'sunset', dim: 20 });
    // Bob's view of the same chat is unaffected
    const bobs = await request(stack.app).get(`/api/conversations/${conv._id}`).set(auth(bob.token));
    expect(bobs.body.conversation.me.wallpaper).toBeNull();

    const def = await request(stack.app).patch('/api/users/settings').set(auth(alice.token)).send({ wallpaper: { kind: 'color', value: '#123ABC' } }).expect(200);
    expect(def.body.user.settings.wallpaper).toMatchObject({ kind: 'color', value: '#123abc', dim: 0 });

    expect((await setChat(alice, { kind: 'color', value: 'red' })).status).toBe(400);
    expect((await setChat(alice, { kind: 'preset', value: '../x' })).status).toBe(400);
    expect((await setChat(alice, null).expect(200)).body.conversation.me.wallpaper).toBeNull();
  });

  it('uploads a wallpaper photo that only its owner can use and see', async () => {
    const up = await upload(alice).expect(201);
    expect(up.body.media.width).toBe(300);
    const res = await setChat(alice, { kind: 'image', mediaId: up.body.media.mediaId, dim: 30 }).expect(200);
    expect(res.body.conversation.me.wallpaper).toMatchObject({ kind: 'image', url: up.body.media.url, dim: 30 });

    expect((await request(stack.app).get(up.body.media.url).set(auth(alice.token))).status).toBe(200);
    expect((await request(stack.app).get(up.body.media.url).set(auth(bob.token))).status).toBe(404);
    // Someone else's upload cannot be applied
    expect((await request(stack.app).patch(`/api/conversations/${conv._id}`).set(auth(bob.token)).send({ wallpaper: { kind: 'image', mediaId: up.body.media.mediaId } })).status).toBe(400);
    expect((await request(stack.app).post('/api/users/wallpaper').set(auth(alice.token)).attach('wallpaper', Buffer.from('not an image'), 'x.txt')).status).toBe(400);

    // Replacing it deletes the old image (no longer used anywhere)
    await setChat(alice, { kind: 'preset', value: 'ocean' }).expect(200);
    expect((await request(stack.app).get(up.body.media.url).set(auth(alice.token))).status).toBe(404);
  });

  it('keeps an image that is still used as the default wallpaper', async () => {
    const up = await upload(alice).expect(201);
    const wallpaper = { kind: 'image', mediaId: up.body.media.mediaId };
    await setChat(alice, wallpaper).expect(200);
    await request(stack.app).patch('/api/users/settings').set(auth(alice.token)).send({ wallpaper }).expect(200);
    await setChat(alice, null).expect(200);
    expect((await request(stack.app).get(up.body.media.url).set(auth(alice.token))).status).toBe(200);
  });
});
