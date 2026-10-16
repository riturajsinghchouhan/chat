import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startStack, registerUser, auth } from './helpers.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { sha256 } from '../src/utils/tokens.js';

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack.stop();
});

describe('authentication', () => {
  it('registers a user without exposing the password hash', async () => {
    const res = await request(stack.app).post('/api/auth/register').send({
      name: 'Alice',
      username: 'alice',
      email: 'alice@example.com',
      password: 'Password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie'][0]).toMatch(/rt=.*HttpOnly/);
    const stored = await User.findOne({ email: 'alice@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe('Password123');
  });

  it('rejects duplicate accounts and weak passwords', async () => {
    const dup = await request(stack.app).post('/api/auth/register').send({
      name: 'Alice 2',
      username: 'alice',
      email: 'other@example.com',
      password: 'Password123',
    });
    expect(dup.status).toBe(409);
    const weak = await request(stack.app).post('/api/auth/register').send({
      name: 'Bob',
      username: 'bob',
      email: 'bob@example.com',
      password: 'short',
    });
    expect(weak.status).toBe(400);
  });

  it('logs in with email or username, and rejects wrong passwords generically', async () => {
    const byEmail = await request(stack.app).post('/api/auth/login').send({ identifier: 'alice@example.com', password: 'Password123' });
    expect(byEmail.status).toBe(200);
    const byName = await request(stack.app).post('/api/auth/login').send({ identifier: 'ALICE', password: 'Password123' });
    expect(byName.status).toBe(200);
    const wrong = await request(stack.app).post('/api/auth/login').send({ identifier: 'alice', password: 'nope12345' });
    const unknown = await request(stack.app).post('/api/auth/login').send({ identifier: 'ghost', password: 'nope12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocks unauthorized API requests', async () => {
    expect((await request(stack.app).get('/api/auth/me')).status).toBe(401);
    expect((await request(stack.app).get('/api/conversations')).status).toBe(401);
    expect((await request(stack.app).get('/api/auth/me').set(auth('garbage'))).status).toBe(401);
  });

  it('rejects NoSQL operator injection in login', async () => {
    const res = await request(stack.app).post('/api/auth/login').send({ identifier: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('rotates refresh tokens, tolerates concurrent tabs, and revokes on late reuse', async () => {
    const { cookie } = await registerUser(stack.app);
    const first = await request(stack.app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    // A second tab using the just-rotated token within the grace window still succeeds.
    const concurrent = await request(stack.app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(concurrent.status).toBe(200);
    expect(concurrent.headers['set-cookie']).toBeUndefined();

    // After the grace window, replaying the old token is treated as theft: session revoked.
    await Session.updateMany({}, { $set: { rotatedAt: new Date(Date.now() - 5 * 60 * 1000) } });
    const replay = await request(stack.app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    const after = await request(stack.app).post('/api/auth/refresh').set('Cookie', first.headers['set-cookie']);
    expect(after.status).toBe(401);
  });

  it('logout invalidates the refresh session', async () => {
    const { cookie } = await registerUser(stack.app);
    await request(stack.app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    expect((await request(stack.app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('forgot password does not reveal whether an account exists, and reset works', async () => {
    const { user } = await registerUser(stack.app);
    const known = await request(stack.app).post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await request(stack.app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const token = 'a'.repeat(64);
    await User.updateOne({ _id: user._id }, { passwordResetTokenHash: sha256(token), passwordResetExpires: new Date(Date.now() + 60000) });
    const reset = await request(stack.app).post('/api/auth/reset-password').send({ token, password: 'NewPassword9' });
    expect(reset.status).toBe(200);
    const reuse = await request(stack.app).post('/api/auth/reset-password').send({ token, password: 'NewPassword9' });
    expect(reuse.status).toBe(400);
    const login = await request(stack.app).post('/api/auth/login').send({ identifier: user.email, password: 'NewPassword9' });
    expect(login.status).toBe(200);
  });

  it('changes password and deletes an account', async () => {
    const u = await registerUser(stack.app);
    const bad = await request(stack.app).post('/api/auth/change-password').set(auth(u.token)).send({ currentPassword: 'wrong', newPassword: 'Another123' });
    expect(bad.status).toBe(400);
    const ok = await request(stack.app).post('/api/auth/change-password').set(auth(u.token)).send({ currentPassword: u.password, newPassword: 'Another123' });
    expect(ok.status).toBe(200);
    const del = await request(stack.app).delete('/api/users/me').set(auth(u.token)).send({ password: 'Another123' });
    expect(del.status).toBe(200);
    expect(await User.exists({ _id: u.user._id })).toBeNull();
  });
});
