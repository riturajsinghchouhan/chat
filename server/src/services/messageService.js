import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message, MESSAGE_POPULATE } from '../models/Message.js';
import { User } from '../models/User.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';
import { objectId, parsePayload } from '../utils/validate.js';
import { emitToUsers } from '../socket/io.js';
import { findFile, markAttached, mediaUrl } from './storage.js';
import { logger } from '../utils/logger.js';

const { ObjectId } = mongoose.Types;
const oid = (id) => new ObjectId(String(id));

const httpsUrl = z.string().url().max(1000);

export const sendMessageSchema = z.object({
  clientId: z.string().min(8).max(64).regex(/^[\w-]+$/, 'Invalid clientId'),
  conversationId: objectId,
  type: z.enum(['text', 'image', 'file', 'gif']),
  text: z.string().max(4000, 'Message is too long').optional().default(''),
  mediaId: objectId.optional(),
  gif: z
    .object({
      providerId: z.string().min(1).max(64),
      url: httpsUrl,
      previewUrl: httpsUrl.optional(),
      width: z.number().int().positive().max(5000).optional(),
      height: z.number().int().positive().max(5000).optional(),
      title: z.string().max(200).optional(),
    })
    .optional(),
  replyTo: objectId.nullable().optional(),
});

const GIF_HOST = /(^|\.)giphy\.com$/i;
function assertGifUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('Invalid GIF URL');
  }
  if (url.protocol !== 'https:' || !GIF_HOST.test(url.hostname)) throw badRequest('Unsupported GIF source');
}

const hasId = (list, id) => list.some((x) => String(x) === String(id));

/** Ensures `userId` may post in the conversation (membership, blocks, group permissions). */
export async function getSendableConversation(conversationId, userId) {
  const conv = await Conversation.findOne({ _id: conversationId, 'members.user': userId });
  if (!conv) throw notFound('Conversation not found');
  let receiverId = null;
  if (conv.type === 'direct') {
    const otherId = conv.members.find((m) => String(m.user) !== String(userId))?.user;
    const [me, other] = await Promise.all([
      User.findById(userId).select('blockedUsers'),
      otherId ? User.findById(otherId).select('blockedUsers') : null,
    ]);
    if (!me) throw new AppError(401, 'Account not found', 'UNAUTHORIZED');
    if (!other) throw new AppError(410, 'This account no longer exists', 'USER_GONE');
    if (hasId(me.blockedUsers, otherId) || hasId(other.blockedUsers, userId)) {
      logger.warn('Message blocked', { senderId: String(userId), receiverId: String(otherId) });
      throw forbidden(hasId(me.blockedUsers, otherId) ? 'Unblock this user to send messages' : 'You cannot message this user', 'BLOCKED');
    }
    receiverId = otherId;
  } else {
    const me = conv.getMember(userId);
    if (conv.settings?.adminsOnlyMessages && me.role !== 'admin') {
      throw forbidden('Only admins can send messages in this group', 'ADMINS_ONLY');
    }
  }
  return { conv, receiverId };
}

/**
 * Persists a message FIRST, then updates the conversation and broadcasts it.
 * Duplicate (senderId, clientId) pairs resolve to the already-stored message.
 */
export async function persistAndBroadcast({ conv, senderId, receiverId = null, clientId, fields }) {
  let msg;
  try {
    msg = await Message.create({ conversationId: conv._id, senderId, receiverId, clientId, ...fields });
  } catch (err) {
    if (err?.code === 11000 && clientId) {
      const existing = await Message.findOne({ senderId, clientId }).populate(MESSAGE_POPULATE);
      if (existing) {
        logger.info('Duplicate send ignored (race)', { senderId: String(senderId), clientId });
        return { message: existing.toJSON(), duplicate: true };
      }
    }
    throw err;
  }

  const attach = [fields.mediaId, fields.thumbnailId].filter(Boolean);
  if (attach.length) await markAttached(attach);

  await Conversation.updateOne(
    { _id: conv._id },
    {
      $set: { lastMessage: msg._id, lastMessageAt: msg.createdAt },
      $inc: { 'members.$[m].unreadCount': 1 },
    },
    { arrayFilters: [{ 'm.user': { $ne: oid(senderId) } }] },
  );

  await msg.populate(MESSAGE_POPULATE);
  const message = msg.toJSON();
  emitToUsers(conv.memberIds(), 'message:new', { message });
  logger.info('Message sent', {
    messageId: String(msg._id),
    conversationId: String(conv._id),
    senderId: String(senderId),
    type: fields.type,
    recipients: conv.members.length - 1,
  });
  return { message, duplicate: false };
}

export async function sendMessage({ userId, payload }) {
  const data = parsePayload(sendMessageSchema, payload);

  const existing = await Message.findOne({ senderId: userId, clientId: data.clientId }).populate(MESSAGE_POPULATE);
  if (existing) {
    if (String(existing.conversationId) !== data.conversationId) throw conflict('Duplicate client id');
    logger.info('Duplicate send ignored (retry)', { messageId: String(existing._id), senderId: String(userId) });
    return { message: existing.toJSON(), duplicate: true };
  }

  const { conv, receiverId } = await getSendableConversation(data.conversationId, userId);
  const fields = { type: data.type, text: (data.text || '').trim() };

  if (data.type === 'text') {
    if (!fields.text) throw badRequest('Message cannot be empty');
  } else if (data.type === 'image' || data.type === 'file') {
    if (!data.mediaId) throw badRequest('mediaId is required');
    const file = await findFile(data.mediaId);
    const meta = file?.metadata;
    if (
      !file ||
      meta.kind !== 'message' ||
      String(meta.ownerId) !== String(userId) ||
      String(meta.conversationId) !== String(conv._id)
    ) {
      throw badRequest('Invalid media', 'INVALID_MEDIA');
    }
    if (meta.mediaType !== data.type) throw badRequest('Media type mismatch', 'INVALID_MEDIA');
    Object.assign(fields, {
      mediaId: file._id,
      mediaUrl: mediaUrl(file._id),
      thumbnailId: meta.thumbnailId || null,
      thumbnailUrl: meta.thumbnailId ? mediaUrl(meta.thumbnailId) : null,
      mimeType: meta.contentType,
      fileName: meta.originalName,
      fileSize: file.length,
      width: meta.width ?? null,
      height: meta.height ?? null,
    });
  } else if (data.type === 'gif') {
    if (!data.gif) throw badRequest('gif is required');
    assertGifUrl(data.gif.url);
    if (data.gif.previewUrl) assertGifUrl(data.gif.previewUrl);
    Object.assign(fields, {
      provider: 'giphy',
      providerId: data.gif.providerId,
      mediaUrl: data.gif.url,
      thumbnailUrl: data.gif.previewUrl || data.gif.url,
      mimeType: 'image/gif',
      fileName: data.gif.title || 'GIF',
      width: data.gif.width ?? null,
      height: data.gif.height ?? null,
    });
  }

  if (data.replyTo) {
    const target = await Message.exists({ _id: data.replyTo, conversationId: conv._id });
    if (!target) throw badRequest('The message you replied to no longer exists');
    fields.replyTo = data.replyTo;
  }

  return persistAndBroadcast({ conv, senderId: userId, receiverId, clientId: data.clientId, fields });
}

export async function createSystemMessage(conv, actorId, text) {
  return persistAndBroadcast({ conv, senderId: actorId, fields: { type: 'system', text } });
}

/** Loads a message only if the user is a member of its conversation. */
export async function loadMessageForMember(messageId, userId) {
  const msg = await Message.findById(messageId);
  if (!msg) throw notFound('Message not found');
  const conv = await Conversation.findOne({ _id: msg.conversationId, 'members.user': userId });
  if (!conv) throw notFound('Message not found');
  return { msg, conv };
}

export async function broadcastMessageUpdate(msg, conv) {
  await msg.populate(MESSAGE_POPULATE);
  const message = msg.toJSON();
  emitToUsers(conv.memberIds(), 'message:updated', { message });
  return message;
}

/** Recipient acknowledges receipt. Only messages in the user's conversations are affected. */
export async function markDelivered({ userId, messageIds }) {
  const ids = [...new Set(messageIds.map(String))].slice(0, 500);
  if (!ids.length) return 0;
  const msgs = await Message.find({ _id: { $in: ids }, senderId: { $ne: userId }, deletedAt: null })
    .select('conversationId senderId receiverId status deliveredTo')
    .lean();
  if (!msgs.length) return 0;
  const convIds = [...new Set(msgs.map((m) => String(m.conversationId)))];
  const allowed = new Set(
    (await Conversation.find({ _id: { $in: convIds }, 'members.user': userId }).distinct('_id')).map(String),
  );
  const now = new Date();
  const targets = msgs.filter(
    (m) =>
      allowed.has(String(m.conversationId)) &&
      !m.deliveredTo.some((d) => String(d.user) === String(userId)) &&
      (!m.receiverId || String(m.receiverId) === String(userId)),
  );
  if (!targets.length) return 0;
  logger.debug('Messages delivered', { userId: String(userId), count: targets.length });

  await Message.updateMany(
    { _id: { $in: targets.map((m) => m._id) }, 'deliveredTo.user': { $ne: oid(userId) } },
    { $push: { deliveredTo: { user: oid(userId), at: now } } },
  );
  await Message.updateMany(
    { _id: { $in: targets.map((m) => m._id) }, status: 'sent' },
    { $set: { status: 'delivered', deliveredAt: now } },
  );

  const bySender = new Map();
  for (const m of targets) {
    const key = `${m.senderId}|${m.conversationId}`;
    if (!bySender.has(key)) bySender.set(key, { senderId: m.senderId, conversationId: m.conversationId, ids: [] });
    bySender.get(key).ids.push(String(m._id));
  }
  for (const { senderId, conversationId, ids: messageIdsForSender } of bySender.values()) {
    emitToUsers([senderId], 'message:delivered', {
      conversationId: String(conversationId),
      messageIds: messageIdsForSender,
      userId: String(userId),
      deliveredAt: now,
    });
  }
  return targets.length;
}

/** On connect: everything sent to this user while offline is now delivered. */
export async function markPendingDelivered(userId) {
  const pending = await Message.find({ receiverId: userId, status: 'sent' }).select('_id').limit(500).lean();
  if (pending.length) await markDelivered({ userId, messageIds: pending.map((m) => m._id) });
}

export async function markConversationRead({ userId, conversationId }) {
  const now = new Date();
  const conv = await Conversation.findOneAndUpdate(
    { _id: conversationId, 'members.user': userId },
    { $set: { 'members.$.unreadCount': 0, 'members.$.lastReadAt': now } },
    { returnDocument: 'after' },
  );
  if (!conv) throw notFound('Conversation not found');

  const uid = oid(userId);
  const cid = conv._id;
  await Message.updateMany(
    { conversationId: cid, senderId: { $ne: uid }, 'readBy.user': { $ne: uid }, createdAt: { $lte: now } },
    { $push: { readBy: { user: uid, at: now } } },
  );
  if (conv.type === 'direct') {
    await Message.updateMany(
      { conversationId: cid, receiverId: uid, deliveredAt: null, createdAt: { $lte: now } },
      { $set: { deliveredAt: now } },
    );
    await Message.updateMany(
      { conversationId: cid, receiverId: uid, status: { $ne: 'read' }, createdAt: { $lte: now } },
      { $set: { status: 'read', readAt: now } },
    );
  } else {
    // Group: a message is "read" once every other current member has read it.
    const others = Math.max(conv.members.length - 1, 1);
    await Message.updateMany(
      { conversationId: cid, status: { $ne: 'read' }, type: { $ne: 'system' }, $expr: { $gte: [{ $size: '$readBy' }, others] } },
      { $set: { status: 'read', readAt: now } },
    );
  }

  logger.debug('Conversation read', { conversationId: String(cid), userId: String(userId) });
  emitToUsers(conv.memberIds(), 'message:read', {
    conversationId: String(cid),
    userId: String(userId),
    readAt: now,
    isGroup: conv.type === 'group',
  });
  return { readAt: now };
}
