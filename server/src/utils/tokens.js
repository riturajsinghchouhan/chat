import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export function signAccessToken(userId) {
  return jwt.sign({ sub: String(userId), typ: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (payload.typ !== 'access') throw new Error('Wrong token type');
  return payload;
}

export function signRefreshToken(userId, sessionId) {
  return jwt.sign(
    { sub: String(userId), sid: String(sessionId), typ: 'refresh', n: randomToken(8) },
    env.JWT_REFRESH_SECRET,
    { expiresIn: `${env.REFRESH_TOKEN_DAYS}d` },
  );
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (payload.typ !== 'refresh') throw new Error('Wrong token type');
  return payload;
}

export const REFRESH_COOKIE = 'rt';

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  };
}

// Short-lived signed media links. <video src> cannot send an Authorization header, so
// streamed media is fetched with ?u=<userId>&exp=<unix>&sig=<hmac> instead.
const mediaKey = () => crypto.createHash('sha256').update(`media-url:${env.JWT_ACCESS_SECRET}`).digest();
const mediaSig = (mediaId, userId, exp) =>
  crypto.createHmac('sha256', mediaKey()).update(`${mediaId}.${userId}.${exp}`).digest('base64url');

export function signMediaAccess(mediaId, userId, ttlSeconds = 6 * 60 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { u: String(userId), exp, sig: mediaSig(String(mediaId), String(userId), exp) };
}

/** Returns the user id the link was issued to, or null if it is invalid or expired. */
export function verifyMediaAccess(mediaId, { u, exp, sig } = {}) {
  const expires = Number(exp);
  if (!u || !sig || !Number.isFinite(expires) || expires < Date.now() / 1000) return null;
  const expected = Buffer.from(mediaSig(String(mediaId), String(u), expires));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? String(u) : null;
}
