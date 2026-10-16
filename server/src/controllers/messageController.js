import crypto from 'node:crypto';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message, MESSAGE_POPULATE } from '../models/Message.js';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { escapeRegex, objectId } from '../utils/validate.js';
import { loadConversationForMember } from '../services/conversationService.js';
import {
  broadcastMessageUpdate,
  getSendableConversation,
  loadMessageForMember,
  markConversationRead,
  persistAndBroadcast,
  sendMessage,
  sendMessageSchema,
} from '../services/messageService.js';
import { deleteFile } from '../services/storage.js';
import { emitToUsers } from '../socket/io.js';
import { logger } from '../utils/logger.js';

export const schemas = {
  convParam: z.object({ conversationId: objectId }),
  idParam: z.object({ messageId: objectId }),
  list: z.object({
    before: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    search: z.string().trim().max(100).optional(),
  }),
  searchAll: z.object({ q: z.string().trim().min(1).max(100) }),
  send: sendMessageSchema,
  edit: z.object({ text: z.string().trim().min(1, 'Message cannot be empty').max(4000) }),
  remove: z.object({ scope: z.enum(['me', 'everyone']).default('me') }),
  bulkRemove: z.object({
    conversationId: objectId,
    messageIds: z.array(objectId).min(1).max(100),
    scope: z.enum(['me', 'everyone']).default('me'),
  }),
  react: z.object({ emoji: z.string().min(1).max(16) }),
  forward: z.object({ conversationIds: z.array(objectId).min(1).max(5) }),
};

export async function listMessages(req, res) {
  const { conversationId } = req.params;
  await loadConversationForMember(conversationId, req.user.id, { populate: false });
  const { before, limit, search } = req.q;
  const filter = { conversationId, hiddenFor: { $ne: req.user.id } };
  if (before) filter._id = { $lt: before };
  if (search) {
    filter.text = { $regex: escapeRegex(search), $options: 'i' };
    filter.deletedAt = null;
    filter.type = { $ne: 'system' };
  }
  const docs = await Message.find(filter).sort({ _id: -1 }).limit(limit).populate(MESSAGE_POPULATE);
  res.json({ messages: docs.reverse().map((m) => m.toJSON()), hasMore: docs.length === limit });
}

export async function searchAllMessages(req, res) {
  const convIds = await Conversation.find({ 'members.user': req.user.id }).distinct('_id');
  const docs = await Message.find({
    conversationId: { $in: convIds },
    hiddenFor: { $ne: req.user.id },
    deletedAt: null,
    type: { $ne: 'system' },
    text: { $regex: escapeRegex(req.q.q), $options: 'i' },
  })
    .sort({ _id: -1 })
    .limit(40)
    .populate(MESSAGE_POPULATE);
  res.json({ messages: docs.map((m) => m.toJSON()) });
}

/** REST fallback for sending (used when the socket is disconnected). Same idempotent path as sockets. */
export async function createMessage(req, res) {
  const { message, duplicate } = await sendMessage({ userId: req.user.id, payload: req.body });
  res.status(duplicate ? 200 : 201).json({ message });
}

export async function editMessage(req, res) {
  const { msg, conv } = await loadMessageForMember(req.params.messageId, req.user.id);
  if (String(msg.senderId) !== req.user.id) throw forbidden('You can only edit your own messages');
  if (msg.deletedAt) throw badRequest('Deleted messages cannot be edited');
  if (!['text', 'image', 'file', 'video'].includes(msg.type)) throw badRequest('This message cannot be edited');
  msg.text = req.body.text;
  msg.editedAt = new Date();
  await msg.save();
  logger.info('Message edited', { messageId: String(msg._id), userId: req.user.id });
  res.json({ message: await broadcastMessageUpdate(msg, conv) });
}

/** Why `userId` may not delete `msg` for everyone, or null if allowed. */
function deleteForEveryoneError(msg, userId) {
  if (String(msg.senderId) !== String(userId)) return 'You can only delete your own messages for everyone';
  if (msg.type === 'system') return 'System messages cannot be deleted';
  if (msg.deletedAt) return null;
  const ageMinutes = (Date.now() - msg.createdAt.getTime()) / 60000;
  if (ageMinutes > env.DELETE_FOR_EVERYONE_MINUTES) {
    return `Messages can only be deleted for everyone within ${env.DELETE_FOR_EVERYONE_MINUTES} minutes`;
  }
  return null;
}

/**
 * Tombstones the messages (content and reactions cleared), removes stored files no other
 * message still references, and unpins them. Returns the updated documents.
 */
async function wipeForEveryone(msgs, conv, userId) {
  const mediaIds = [];
  const wiped = [];
  for (const msg of msgs) {
    if (msg.deletedAt) continue;
    mediaIds.push(...[msg.mediaId, msg.thumbnailId].filter(Boolean));
    Object.assign(msg, {
      text: '',
      mediaId: null,
      thumbnailId: null,
      mediaUrl: null,
      thumbnailUrl: null,
      fileName: null,
      fileSize: null,
      mimeType: null,
      duration: null,
      provider: null,
      providerId: null,
      reactions: [],
      deletedAt: new Date(),
    });
    await msg.save();
    wiped.push(msg);
  }
  logger.info('Messages deleted for everyone', {
    messageIds: wiped.map((m) => String(m._id)),
    conversationId: String(conv._id),
    userId,
  });
  // Remove the stored file unless a forwarded copy still references it.
  for (const id of mediaIds) {
    const stillUsed = await Message.exists({ $or: [{ mediaId: id }, { thumbnailId: id }] });
    if (!stillUsed) await deleteFile(id);
  }
  const ids = new Set(msgs.map((m) => String(m._id)));
  const unpin = conv.pinnedMessages.filter((id) => ids.has(String(id)));
  if (unpin.length) {
    await Conversation.updateOne({ _id: conv._id }, { $pull: { pinnedMessages: { $in: unpin } } });
    emitToUsers(conv.memberIds(), 'conversation:updated', { conversation: { _id: conv._id }, refetch: true });
  }
  return msgs;
}

function hideForMe(conv, userId, messageIds) {
  emitToUsers([userId], 'message:hidden', {
    conversationId: String(conv._id),
    messageIds: messageIds.map(String),
    messageId: String(messageIds[0]), // kept for older clients
  });
}

export async function deleteMessage(req, res) {
  const { msg, conv } = await loadMessageForMember(req.params.messageId, req.user.id);
  const { scope } = req.q;

  if (scope === 'me') {
    await Message.updateOne({ _id: msg._id }, { $addToSet: { hiddenFor: req.user.id } });
    hideForMe(conv, req.user.id, [msg._id]);
    logger.info('Message deleted for me', { messageId: String(msg._id), userId: req.user.id });
    return res.json({ ok: true });
  }

  const error = deleteForEveryoneError(msg, req.user.id);
  if (error) throw msg.type === 'system' ? badRequest(error) : forbidden(error);
  if (msg.deletedAt) return res.json({ message: msg.toJSON() });
  await wipeForEveryone([msg], conv, req.user.id);
  res.json({ message: await broadcastMessageUpdate(msg, conv) });
}

/**
 * Deletes several messages of one conversation at once. "everyone" is all-or-nothing:
 * if any selected message may not be deleted for everyone, nothing is deleted.
 */
export async function bulkDeleteMessages(req, res) {
  const { conversationId, scope } = req.body;
  const messageIds = [...new Set(req.body.messageIds)];
  const conv = await loadConversationForMember(conversationId, req.user.id, { populate: false });
  const msgs = await Message.find({ _id: { $in: messageIds }, conversationId: conv._id, hiddenFor: { $ne: req.user.id } });
  if (msgs.length !== messageIds.length) throw notFound('Some messages were not found');

  if (scope === 'me') {
    await Message.updateMany({ _id: { $in: messageIds }, conversationId: conv._id }, { $addToSet: { hiddenFor: req.user.id } });
    hideForMe(conv, req.user.id, messageIds);
    logger.info('Messages deleted for me', { count: messageIds.length, conversationId: String(conv._id), userId: req.user.id });
    return res.json({ ok: true, messageIds });
  }

  for (const msg of msgs) {
    const error = deleteForEveryoneError(msg, req.user.id);
    if (error) throw forbidden(error, 'CANNOT_DELETE_FOR_EVERYONE');
  }
  await wipeForEveryone(msgs, conv, req.user.id);
  await Message.populate(msgs, MESSAGE_POPULATE);
  const messages = msgs.map((m) => m.toJSON());
  emitToUsers(conv.memberIds(), 'messages:updated', { conversationId: String(conv._id), messages });
  res.json({ messages });
}

export async function reactToMessage(req, res) {
  const { msg, conv } = await loadMessageForMember(req.params.messageId, req.user.id);
  if (msg.deletedAt || msg.type === 'system') throw badRequest('You cannot react to this message');
  const { emoji } = req.body;
  const existing = msg.reactions.find((r) => String(r.user) === req.user.id);
  msg.reactions = msg.reactions.filter((r) => String(r.user) !== req.user.id);
  if (!existing || existing.emoji !== emoji) msg.reactions.push({ user: req.user.id, emoji });
  await msg.save();
  res.json({ message: await broadcastMessageUpdate(msg, conv) });
}

export async function forwardMessage(req, res) {
  const { msg } = await loadMessageForMember(req.params.messageId, req.user.id);
  if (msg.deletedAt || msg.type === 'system') throw badRequest('This message cannot be forwarded');
  const results = [];
  for (const conversationId of [...new Set(req.body.conversationIds)]) {
    const { conv, receiverId } = await getSendableConversation(conversationId, req.user.id);
    const fields = {
      type: msg.type,
      text: msg.text,
      forwarded: true,
      mediaId: msg.mediaId,
      thumbnailId: msg.thumbnailId,
      mediaUrl: msg.mediaUrl,
      thumbnailUrl: msg.thumbnailUrl,
      mimeType: msg.mimeType,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      width: msg.width,
      height: msg.height,
      duration: msg.duration,
      provider: msg.provider,
      providerId: msg.providerId,
    };
    const { message } = await persistAndBroadcast({
      conv,
      senderId: req.user.id,
      receiverId,
      clientId: `fwd-${crypto.randomUUID()}`,
      fields,
    });
    results.push(message);
  }
  logger.info('Message forwarded', { messageId: String(msg._id), userId: req.user.id, targets: results.length });
  res.status(201).json({ messages: results });
}

export async function markRead(req, res) {
  const result = await markConversationRead({ userId: req.user.id, conversationId: req.params.conversationId });
  res.json(result);
}

export async function getMessage(req, res) {
  const { msg } = await loadMessageForMember(req.params.messageId, req.user.id);
  if (msg.hiddenFor.some((id) => String(id) === req.user.id)) throw notFound('Message not found');
  await msg.populate(MESSAGE_POPULATE);
  res.json({ message: msg.toJSON() });
}
