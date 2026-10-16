import { verifyAccessToken } from '../utils/tokens.js';
import { unauthorized } from '../utils/AppError.js';

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Requires a valid access token. Sets req.user = { id }. */
export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) throw unauthorized();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
  } catch {
    throw unauthorized('Session expired', 'TOKEN_EXPIRED');
  }
  next();
}

/** Attaches req.user when a valid token is present, otherwise continues anonymously. */
export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = { id: verifyAccessToken(token).sub };
    } catch {
      /* anonymous */
    }
  }
  next();
}
