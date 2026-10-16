import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startStack, registerUser, auth, uuid, waitFor, connected, directConversation } from './helpers.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';

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

describe('socket.io real-time', () => {
  it('rejects unauthenticated sockets', async () => {
    const s = stack.connect('invalid-token');
    await expect(connected(s)).rejects.toThrow('unauthorized');
  });

  it('delivers messages in real time with acknowledgement and delivery receipts', async () => {
    const a = stack.connect(alice.token);
    const b = stack.connect(bob.token);
    await Promise.all([connected(a), connected(b)]);

    const incoming = waitFor(b, 'message:new');
    const ack = await a.timeout(5000).emitWithAck('message:send', {
      clientId: uuid(),
      conversationId: conv._id,
      type: 'text',
      text: 'hello bob',
    });
    expect(ack.ok).toBe(true);
    expect(ack.message.status).toBe('sent');
    const { message } = await incoming;
    expect(message.text).toBe('hello bob');
    expect(message._id).toBe(ack.message._id);
    expect(await Message.exists({ _id: message._id })).toBeTruthy();

    const delivered = waitFor(a, 'message:delivered');
    b.emit('message:delivered', { messageIds: [message._id] });
    const d = await delivered;
    expect(d.messageIds).toContain(message._id);

    const read = waitFor(a, 'message:read');
    const readAck = await b.timeout(5000).emitWithAck('conversation:read', { conversationId: conv._id });
    expect(readAck.ok).toBe(true);
    const r = await read;
    expect(r.userId).toBe(bob.user._id);
    const stored = await Message.findById(message._id);
    expect(stored.status).toBe('read');
    a.close();
    b.close();
  });

  it('broadcasts typing indicators only to other members', async () => {
    const a = stack.connect(alice.token);
    const b = stack.connect(bob.token);
    const e = stack.connect(eve.token);
    await Promise.all([connected(a), connected(b), connected(e)]);
    let eveSaw = false;
    e.on('typing:start', () => {
      eveSaw = true;
    });
    const typing = waitFor(b, 'typing:start');
    a.emit('typing:start', { conversationId: conv._id });
    const t = await typing;
    expect(t).toEqual({ conversationId: conv._id, userId: alice.user._id });
    await new Promise((r) => setTimeout(r, 200));
    expect(eveSaw).toBe(false);

    // Eve cannot inject typing events into a conversation she is not in
    const ack = await e.timeout(3000).emitWithAck('typing:start', { conversationId: conv._id });
    expect(ack.ok).toBe(true);
    a.close();
    b.close();
    e.close();
  });

  it('never trusts a client-supplied sender id and blocks non-members', async () => {
    const e = stack.connect(eve.token);
    await connected(e);
    const ack = await e.timeout(5000).emitWithAck('message:send', {
      clientId: uuid(),
      conversationId: conv._id,
      type: 'text',
      text: 'spoof',
      senderId: alice.user._id,
    });
    expect(ack.ok).toBe(false);
    expect(ack.error.status).toBe(404);
    e.close();
  });

  it('prevents duplicates when the same message is retried after a reconnect', async () => {
    const clientId = uuid();
    const payload = { clientId, conversationId: conv._id, type: 'text', text: 'retry me' };
    const a1 = stack.connect(alice.token);
    await connected(a1);
    const first = await a1.timeout(5000).emitWithAck('message:send', payload);
    a1.close();

    const a2 = stack.connect(alice.token);
    await connected(a2);
    const second = await a2.timeout(5000).emitWithAck('message:send', payload);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.message._id).toBe(first.message._id);
    expect(await Message.countDocuments({ clientId })).toBe(1);
    a2.close();
  });

  it('tracks presence across multiple tabs and marks offline messages delivered on reconnect', async () => {
    const tab1 = stack.connect(bob.token);
    const tab2 = stack.connect(bob.token);
    await Promise.all([connected(tab1), connected(tab2)]);
    expect((await User.findById(bob.user._id)).isOnline).toBe(true);
    tab1.close();
    await new Promise((r) => setTimeout(r, 200));
    expect((await User.findById(bob.user._id)).isOnline).toBe(true);
    tab2.close();
    await new Promise((r) => setTimeout(r, 300));
    expect((await User.findById(bob.user._id)).isOnline).toBe(false);

    // Alice sends while Bob is offline
    const res = await request(stack.app)
      .post('/api/messages')
      .set(auth(alice.token))
      .send({ clientId: uuid(), conversationId: conv._id, type: 'text', text: 'while offline' });
    expect(res.body.message.status).toBe('sent');

    const a = stack.connect(alice.token);
    await connected(a);
    const delivered = waitFor(a, 'message:delivered');
    const b = stack.connect(bob.token);
    await connected(b);
    const d = await delivered;
    expect(d.messageIds).toContain(res.body.message._id);
    a.close();
    b.close();
  });

  it('enforces blocks over sockets too', async () => {
    await request(stack.app).post(`/api/users/${alice.user._id}/block`).set(auth(bob.token)).expect(200);
    const a = stack.connect(alice.token);
    await connected(a);
    const ack = await a.timeout(5000).emitWithAck('message:send', { clientId: uuid(), conversationId: conv._id, type: 'text', text: 'x' });
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('BLOCKED');
    await request(stack.app).delete(`/api/users/${alice.user._id}/block`).set(auth(bob.token)).expect(200);
    a.close();
  });
});
