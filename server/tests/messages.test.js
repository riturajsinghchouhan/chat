import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startStack, registerUser, auth, uuid, directConversation } from './helpers.js';
import { Message } from '../src/models/Message.js';

let stack;
let alice;
let bob;
let eve;
let conv;

beforeAll(async () => {
  stack = await startStack();
  alice = await registerUser(stack.app);
  bob = await registerUser(stack.app);
  eve = await registerUser(stack.app);
  conv = await directConversation(stack.app, alice, bob);
});
afterAll(async () => {
  await stack.stop();
});

const send = (user, body) => request(stack.app).post('/api/messages').set(auth(user.token)).send(body);

describe('conversations & messages', () => {
  it('creating a direct conversation twice returns the same one', async () => {
    const again = await directConversation(stack.app, bob, alice);
    expect(again._id).toBe(conv._id);
  });

  it('prevents access to private conversations by non-members', async () => {
    expect((await request(stack.app).get(`/api/conversations/${conv._id}`).set(auth(eve.token))).status).toBe(404);
    expect((await request(stack.app).get(`/api/messages/${conv._id}`).set(auth(eve.token))).status).toBe(404);
    const res = await send(eve, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'intrude' });
    expect(res.status).toBe(404);
  });

  it('persists messages and paginates history', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: `msg ${i}` });
      expect(res.status).toBe(201);
    }
    const page1 = await request(stack.app).get(`/api/messages/${conv._id}?limit=3`).set(auth(bob.token));
    expect(page1.body.messages.map((m) => m.text)).toEqual(['msg 2', 'msg 3', 'msg 4']);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await request(stack.app).get(`/api/messages/${conv._id}?limit=3&before=${page1.body.messages[0]._id}`).set(auth(bob.token));
    expect(page2.body.messages.map((m) => m.text)).toEqual(['msg 0', 'msg 1']);
  });

  it('is idempotent for a repeated clientId (no duplicate messages)', async () => {
    const clientId = uuid();
    const first = await send(alice, { clientId, conversationId: conv._id, type: 'text', text: 'once' });
    const second = await send(alice, { clientId, conversationId: conv._id, type: 'text', text: 'once' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.message._id).toBe(first.body.message._id);
    expect(await Message.countDocuments({ clientId })).toBe(1);
  });

  it('rejects empty and oversized messages', async () => {
    expect((await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: '   ' })).status).toBe(400);
    expect((await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'x'.repeat(4001) })).status).toBe(400);
  });

  it('only lets the sender edit or delete-for-everyone their message', async () => {
    const { body } = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'original' });
    const id = body.message._id;
    expect((await request(stack.app).patch(`/api/messages/${id}`).set(auth(bob.token)).send({ text: 'hacked' })).status).toBe(403);
    expect((await request(stack.app).patch(`/api/messages/${id}`).set(auth(eve.token)).send({ text: 'hacked' })).status).toBe(404);
    const edit = await request(stack.app).patch(`/api/messages/${id}`).set(auth(alice.token)).send({ text: 'edited' });
    expect(edit.body.message.text).toBe('edited');
    expect(edit.body.message.editedAt).toBeTruthy();

    expect((await request(stack.app).delete(`/api/messages/${id}?scope=everyone`).set(auth(bob.token))).status).toBe(403);
    const del = await request(stack.app).delete(`/api/messages/${id}?scope=everyone`).set(auth(alice.token));
    expect(del.body.message.deletedAt).toBeTruthy();
    expect(del.body.message.text).toBe('');
  });

  it('delete-for-me hides the message only for that user', async () => {
    const { body } = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'hide me' });
    await request(stack.app).delete(`/api/messages/${body.message._id}?scope=me`).set(auth(bob.token)).expect(200);
    const bobView = await request(stack.app).get(`/api/messages/${conv._id}?limit=100`).set(auth(bob.token));
    const aliceView = await request(stack.app).get(`/api/messages/${conv._id}?limit=100`).set(auth(alice.token));
    expect(bobView.body.messages.some((m) => m._id === body.message._id)).toBe(false);
    expect(aliceView.body.messages.some((m) => m._id === body.message._id)).toBe(true);
  });

  it('supports reactions, replies, pins, forwarding and search', async () => {
    const { body } = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'pizza tonight?' });
    const id = body.message._id;
    const react = await request(stack.app).post(`/api/messages/${id}/reactions`).set(auth(bob.token)).send({ emoji: '👍' });
    expect(react.body.message.reactions).toHaveLength(1);
    const unreact = await request(stack.app).post(`/api/messages/${id}/reactions`).set(auth(bob.token)).send({ emoji: '👍' });
    expect(unreact.body.message.reactions).toHaveLength(0);

    const reply = await send(bob, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'yes!', replyTo: id });
    expect(reply.body.message.replyTo._id).toBe(id);

    const pin = await request(stack.app).post(`/api/conversations/${conv._id}/pins`).set(auth(bob.token)).send({ messageId: id });
    expect(pin.body.pinned).toBe(true);

    const other = await directConversation(stack.app, alice, eve);
    const fwd = await request(stack.app).post(`/api/messages/${id}/forward`).set(auth(alice.token)).send({ conversationIds: [other._id] });
    expect(fwd.status).toBe(201);
    expect(fwd.body.messages[0].forwarded).toBe(true);
    // Bob cannot forward into a conversation he is not part of
    const bad = await request(stack.app).post(`/api/messages/${id}/forward`).set(auth(bob.token)).send({ conversationIds: [other._id] });
    expect(bad.status).toBe(404);

    const search = await request(stack.app).get(`/api/messages/${conv._id}?search=pizza`).set(auth(bob.token));
    expect(search.body.messages).toHaveLength(1);
    const global = await request(stack.app).get('/api/messages/search?q=pizza').set(auth(eve.token));
    expect(global.body.messages).toHaveLength(1); // only the forwarded copy Eve can see
  });

  it('blocked users cannot message each other', async () => {
    await request(stack.app).post(`/api/users/${alice.user._id}/block`).set(auth(bob.token)).expect(200);
    const res = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'hi?' });
    expect(res.status).toBe(403);
    await request(stack.app).delete(`/api/users/${alice.user._id}/block`).set(auth(bob.token)).expect(200);
    const ok = await send(alice, { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'hi again' });
    expect(ok.status).toBe(201);
  });

  it('only accepts GIFs from the GIF provider', async () => {
    const bad = await send(alice, {
      clientId: uuid(),
      conversationId: conv._id,
      type: 'gif',
      gif: { providerId: 'x', url: 'https://evil.example.com/a.gif' },
    });
    expect(bad.status).toBe(400);
    const good = await send(alice, {
      clientId: uuid(),
      conversationId: conv._id,
      type: 'gif',
      gif: { providerId: 'abc', url: 'https://media1.giphy.com/media/abc/giphy.gif', previewUrl: 'https://media1.giphy.com/media/abc/200w.gif', width: 480, height: 270 },
    });
    expect(good.status).toBe(201);
    expect(good.body.message.provider).toBe('giphy');
    expect(good.body.message.mediaUrl).toContain('giphy.com');
  });

  it('GIF search returns 503 when the provider is not configured', async () => {
    const res = await request(stack.app).get('/api/gifs/trending').set(auth(alice.token));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GIF_NOT_CONFIGURED');
  });
});
