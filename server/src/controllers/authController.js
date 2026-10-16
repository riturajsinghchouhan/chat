import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { env } from '../config/env.js';
import { AppError, badRequest, conflict, unauthorized } from '../utils/AppError.js';
import {
  REFRESH_COOKIE,
  randomToken,
  refreshCookieOptions,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { disconnectUser } from '../socket/io.js';
import { logger } from '../utils/logger.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_GRACE_MS = 30 * 1000;
// Used to keep login timing similar whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', 10);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-z0-9_.]+$/, 'Username may contain letters, numbers, "_" and "." only');

export const schemas = {
  register: z.object({
    name: z.string().trim().min(1, 'Name is required').max(60),
    username: usernameSchema,
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
    password: passwordSchema,
  }),
  login: z.object({
    identifier: z.string().trim().toLowerCase().min(1, 'Email or username is required').max(254),
    password: z.string().min(1, 'Password is required').max(128),
  }),
  forgot: z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').max(254) }),
  reset: z.object({ token: z.string().regex(/^[a-f\d]{64}$/, 'Invalid or expired reset link'), password: passwordSchema }),
  changePassword: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }),
};

async function issueSession(req, res, user) {
  const session = await Session.create({
    user: user._id,
    tokenHash: 'pending',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000),
  });
  const refreshToken = signRefreshToken(user._id, session._id);
  session.tokenHash = sha256(refreshToken);
  await session.save();
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return signAccessToken(user._id);
}

function clearRefreshCookie(res) {
  const { maxAge: _maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

export async function register(req, res) {
  const { name, username, email, password } = req.body;
  const exists = await User.exists({ $or: [{ email }, { username }] });
  if (exists) {
    logger.warn('Registration rejected: account exists', { ip: req.ip });
    throw conflict('Email or username is already in use', 'ACCOUNT_EXISTS');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ name, username, email, passwordHash });
  const accessToken = await issueSession(req, res, user);
  logger.info('User registered', { userId: String(user._id), username: user.username });
  res.status(201).json({ user, accessToken });
}

export async function login(req, res) {
  const { identifier, password } = req.body;
  const user = await User.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier }).select(
    '+passwordHash',
  );
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    logger.warn('Login failed', { reason: user ? 'wrong_password' : 'unknown_account', userId: user ? String(user._id) : undefined, ip: req.ip });
    throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }
  const accessToken = await issueSession(req, res, user);
  logger.info('User logged in', { userId: String(user._id), ip: req.ip });
  res.json({ user, accessToken });
}

export async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session', 'NO_SESSION');
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    clearRefreshCookie(res);
    throw unauthorized('Session expired', 'SESSION_EXPIRED');
  }
  const session = await Session.findById(payload.sid);
  const hash = sha256(token);
  const inGrace =
    session?.prevTokenHash === hash && session.rotatedAt && Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS;
  if (session && inGrace && String(session.user) === payload.sub) {
    // Another tab already rotated this token moments ago; its response set the newest cookie.
    const graceUser = await User.findById(payload.sub);
    if (graceUser) return res.json({ user: graceUser, accessToken: signAccessToken(graceUser._id) });
  }
  if (!session || session.tokenHash !== hash || String(session.user) !== payload.sub) {
    // A rotated (old) refresh token was replayed: revoke that session entirely.
    if (session) {
      logger.warn('Refresh token reuse detected, session revoked', { userId: payload.sub, sessionId: payload.sid, ip: req.ip });
      await session.deleteOne();
    }
    clearRefreshCookie(res);
    throw unauthorized('Session expired', 'SESSION_EXPIRED');
  }
  const user = await User.findById(payload.sub);
  if (!user) {
    await session.deleteOne();
    clearRefreshCookie(res);
    throw unauthorized('Account not found', 'SESSION_EXPIRED');
  }
  // Rotate the refresh token on every use.
  const nextToken = signRefreshToken(user._id, session._id);
  session.prevTokenHash = session.tokenHash;
  session.rotatedAt = new Date();
  session.tokenHash = sha256(nextToken);
  session.expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000);
  await session.save();
  res.cookie(REFRESH_COOKIE, nextToken, refreshCookieOptions());
  res.json({ user, accessToken: signAccessToken(user._id) });
}

export async function logout(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await Session.deleteOne({ _id: payload.sid, tokenHash: sha256(token) });
      logger.info('User logged out', { userId: payload.sub });
    } catch {
      /* already invalid */
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) throw unauthorized('Account not found');
  res.json({ user });
}

const GENERIC_FORGOT = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };

export async function forgotPassword(req, res) {
  const user = await User.findOne({ email: req.body.email });
  if (user) {
    const token = randomToken(32);
    user.passwordResetTokenHash = sha256(token);
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const resetUrl = `${env.CLIENT_URL}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
      logger.info('Password reset requested', { userId: String(user._id) });
    } catch (err) {
      // Not revealed to the client (prevents account enumeration), but logged for operators.
      logger.error('Password reset email failed', { userId: String(user._id), err: err.message });
    }
  } else {
    logger.info('Password reset requested for unknown email', { ip: req.ip });
  }
  res.json(GENERIC_FORGOT);
}

export async function resetPassword(req, res) {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(req.body.token),
    passwordResetExpires: { $gt: new Date() },
  });
  if (!user) {
    logger.warn('Invalid or expired password reset token used', { ip: req.ip });
    throw badRequest('Invalid or expired reset link', 'INVALID_RESET_TOKEN');
  }
  user.passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  await Session.deleteMany({ user: user._id });
  disconnectUser(user._id);
  logger.info('Password reset completed, all sessions revoked', { userId: String(user._id) });
  res.json({ ok: true, message: 'Password updated. Please sign in.' });
}

export async function changePassword(req, res) {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw unauthorized();
  const ok = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
  if (!ok) {
    logger.warn('Change password failed: wrong current password', { userId: req.user.id });
    throw new AppError(400, 'Current password is incorrect', 'INVALID_PASSWORD');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
  await user.save();
  // Sign out every other device; keep the current one by issuing a fresh session.
  await Session.deleteMany({ user: user._id });
  const accessToken = await issueSession(req, res, user);
  logger.info('Password changed, other sessions revoked', { userId: req.user.id });
  res.json({ ok: true, accessToken });
}
