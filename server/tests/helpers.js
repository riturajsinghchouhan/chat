import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/socket/index.js';
import { setIO } from '../src/socket/io.js';

/**
 * Boots the full stack (Express + Socket.IO + MongoDB) on a random port.
 * Uses MONGODB_TEST_URI when set (e.g. a local mongod), otherwise an in-memory MongoDB.
 */
export async function startStack() {
  let mongo = null;
  let uri = process.env.MONGODB_TEST_URI;
  if (uri) {
    uri = uri.replace(/\/[^/?]*(\?|$)/, `/chat_test_${crypto.randomBytes(4).toString('hex')}$1`);
  } else {
    mongo = await MongoMemoryServer.create();
    uri = mongo.getUri();
  }
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  return {
    app,
    url,
    io,
    connect(token, opts = {}) {
      const socket = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
      sockets.push(socket);
      return socket;
    },
    async stop() {
      sockets.forEach((s) => s.close());
      io.close();
      setIO(null);
      await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
      if (mongo) await mongo.stop();
    },
  };
}

let counter = 0;
export async function registerUser(app, overrides = {}) {
  counter += 1;
  const n = `${Date.now().toString(36)}${counter}`;
  const body = {
    name: `User ${n}`,
    username: `user_${n}`,
    email: `user_${n}@example.com`,
    password: 'Password123',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.accessToken, cookie: res.headers['set-cookie'], password: body.password };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export const waitFor = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });

export const connected = (socket) =>
  new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

export const uuid = () => crypto.randomUUID();

export async function directConversation(app, a, b) {
  const res = await request(app).post('/api/conversations').set(auth(a.token)).send({ userId: b.user._id });
  return res.body.conversation;
}
