import { Server } from 'socket.io';
import { z } from 'zod';
import { corsOptions } from '../app.js';
import { env } from '../config/env.js';
import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { objectId, parsePayload } from '../utils/validate.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { contactIdsOf } from '../services/conversationService.js';
import {
  markConversationRead,
  markDelivered,
  markPendingDelivered,
  sendMessage,
} from '../services/messageService.js';
import { emitToUsers, setIO, userRoom } from './io.js';

const convPayload = z.object({ conversationId: objectId });
// null = not looking at any chat (closed it, switched tab, minimized)
const viewPayload = z.object({ conversationId: objectId.nullable() });
const deliveredPayload = z.object({ messageIds: z.array(objectId).min(1).max(500) });
const tokenPayload = z.object({ token: z.string().min(10).max(2000) });

/** Sliding-window limiter per socket and event group. */
function limiter(limit, windowMs) {
  let hits = [];
  return () => {
    const now = Date.now();
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

function toAckError(err) {
  if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message, status: err.status } };
  logger.error('Socket handler error', { err: err?.message, stack: err?.stack });
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', status: 500 } };
}

export async function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: corsOptions,
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5, // 100 KB — media goes over HTTP upload, never through the socket
  });

  if (env.REDIS_URL) {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { createClient } = await import('redis');
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    pub.on('error', (e) => logger.error('Redis pub error', { err: e.message }));
    sub.on('error', (e) => logger.error('Redis sub error', { err: e.message }));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled (multi-instance mode)');
  }

  // Authenticate every connection. The user id ALWAYS comes from the verified token.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        logger.warn('Socket rejected: no token', { ip: socket.handshake.address });
        return next(new Error('unauthorized'));
      }
      const payload = verifyAccessToken(token);
      const exists = await User.exists({ _id: payload.sub });
      if (!exists) {
        logger.warn('Socket rejected: unknown user', { userId: payload.sub });
        return next(new Error('unauthorized'));
      }
      socket.data.userId = payload.sub;
      socket.data.tokenExp = payload.exp;
      return next();
    } catch (err) {
      logger.warn('Socket rejected: invalid token', { reason: err.name, ip: socket.handshake.address });
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => handleConnection(io, socket));
  setIO(io);
  return io;
}

async function handleConnection(io, socket) {
  const userId = socket.data.userId;
  socket.join(userRoom(userId));
  logger.info('Socket connected', { userId, socketId: socket.id, transport: socket.conn.transport.name });
  socket.conn.once('upgrade', () => logger.debug('Socket upgraded to websocket', { userId, socketId: socket.id }));

  const limits = {
    send: limiter(30, 10000),
    typing: limiter(30, 5000),
    read: limiter(40, 10000),
    delivered: limiter(60, 10000),
    view: limiter(40, 10000),
  };
  // Small per-socket cache of conversation membership for high-frequency typing events.
  const membership = new Map();

  async function memberIdsFor(conversationId) {
    const cached = membership.get(conversationId);
    if (cached && cached.expires > Date.now()) return cached.ids;
    const conv = await Conversation.findOne({ _id: conversationId, 'members.user': userId }).select('members.user type');
    let ids = conv ? conv.memberIds() : null;
    if (conv?.type === 'direct') {
      const otherId = ids.find((id) => id !== userId);
      const blocked = await User.exists({
        $or: [
          { _id: userId, blockedUsers: otherId },
          { _id: otherId, blockedUsers: userId },
        ],
      });
      if (blocked) ids = null;
    }
    membership.set(conversationId, { ids, expires: Date.now() + 60000 });
    return ids;
  }

  const tokenExpired = () => Date.now() / 1000 > socket.data.tokenExp;

  /** Wraps a handler with auth-expiry check, rate limiting, error handling and acknowledgement. */
  const on = (event, limit, handler) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (tokenExpired()) {
        logger.info('Socket token expired, disconnecting', { userId, socketId: socket.id, event });
        reply({ ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Session expired', status: 401 } });
        socket.emit('auth:expired');
        socket.disconnect(true);
        return;
      }
      if (limit && !limit()) {
        logger.warn('Socket rate limited', { userId, socketId: socket.id, event });
        reply({ ok: false, error: { code: 'RATE_LIMITED', message: 'You are sending too fast', status: 429 } });
        return;
      }
      try {
        const result = await handler(payload);
        reply({ ok: true, ...(result || {}) });
      } catch (err) {
        if (err instanceof AppError && err.status < 500) {
          logger.warn('Socket event rejected', { userId, event, code: err.code, message: err.message });
        }
        reply(toAckError(err));
      }
    });
  };

  // Allow the client to extend this socket's session with a freshly refreshed access token.
  socket.on('auth:refresh', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const { token } = parsePayload(tokenPayload, payload);
      const decoded = verifyAccessToken(token);
      if (decoded.sub !== userId) throw new Error('mismatch');
      socket.data.tokenExp = decoded.exp;
      logger.debug('Socket session extended', { userId, socketId: socket.id });
      reply({ ok: true });
    } catch {
      logger.warn('Socket auth:refresh rejected', { userId, socketId: socket.id });
      reply({ ok: false });
    }
  });

  on('message:send', limits.send, async (payload) => {
    const { message, duplicate } = await sendMessage({ userId, payload });
    return { message, duplicate };
  });

  on('message:delivered', limits.delivered, async (payload) => {
    const { messageIds } = parsePayload(deliveredPayload, payload);
    await markDelivered({ userId, messageIds });
  });

  on('conversation:read', limits.read, async (payload) => {
    const { conversationId } = parsePayload(convPayload, payload);
    return markConversationRead({ userId, conversationId });
  });

  for (const event of ['typing:start', 'typing:stop']) {
    on(event, limits.typing, async (payload) => {
      const { conversationId } = parsePayload(convPayload, payload);
      const ids = await memberIdsFor(conversationId);
      if (!ids) return;
      const others = ids.filter((id) => id !== userId);
      emitToUsers(others, event, { conversationId, userId });
    });
  }

  // ---- "Who is looking at this chat" (avatar peek at the bottom of the chat) ----
  // socket.data.viewing is readable from every instance via fetchSockets (Redis adapter).

  /** True if another tab/device of this user is still viewing the conversation. */
  async function stillViewingElsewhere(conversationId) {
    const mine = await io.in(userRoom(userId)).fetchSockets();
    return mine.some((s) => s.id !== socket.id && s.data.viewing === conversationId);
  }

  async function announceViewing(conversationId, viewing) {
    const ids = await memberIdsFor(conversationId);
    if (!ids) return;
    if (!viewing && (await stillViewingElsewhere(conversationId))) return;
    emitToUsers(
      ids.filter((id) => id !== userId),
      'chat:viewing',
      { conversationId, userId, viewing },
    );
  }

  on('chat:view', limits.view, async (payload) => {
    const { conversationId } = parsePayload(viewPayload, payload);
    const previous = socket.data.viewing || null;
    const ids = conversationId ? await memberIdsFor(conversationId) : null;
    const next = ids ? conversationId : null; // not a member, or blocked → share nothing
    socket.data.viewing = next;
    if (previous && previous !== next) await announceViewing(previous, false);
    if (!next) return { viewers: [] };
    if (previous !== next) await announceViewing(next, true);
    // Who of the other members is looking at it right now
    const others = ids.filter((id) => id !== userId);
    const sockets = others.length ? await io.in(others.map(userRoom)).fetchSockets() : [];
    const viewers = [...new Set(sockets.filter((s) => s.data.viewing === next).map((s) => s.data.userId))];
    return { viewers };
  });

  socket.on('disconnect', async (reason) => {
    logger.info('Socket disconnected', { userId, socketId: socket.id, reason });
    const viewing = socket.data.viewing;
    socket.data.viewing = null;
    if (viewing) announceViewing(viewing, false).catch(() => {});
    try {
      const remaining = await io.in(userRoom(userId)).fetchSockets();
      if (remaining.length > 0) return; // still connected on another tab/device
      const lastSeen = new Date();
      await User.updateOne({ _id: userId }, { $set: { isOnline: false, lastSeen } });
      logger.info('User offline', { userId });
      emitToUsers(await contactIdsOf(userId), 'user:offline', { userId, lastSeen });
    } catch (err) {
      logger.warn('Presence update failed', { err: err.message });
    }
  });

  // Presence + catch-up delivery receipts
  try {
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    await User.updateOne({ _id: userId }, { $set: { isOnline: true, lastSeen: new Date() } });
    if (sockets.length <= 1) {
      logger.info('User online', { userId });
      emitToUsers(await contactIdsOf(userId), 'user:online', { userId });
    } else {
      logger.debug('Additional tab/device connected', { userId, sockets: sockets.length });
    }
    await markPendingDelivered(userId);
  } catch (err) {
    logger.warn('Connection setup failed', { err: err.message });
  }
}
