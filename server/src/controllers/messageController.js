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
  if (!['text', 'image', 'file'].includes(msg.type)) throw badRequest('This message cannot be edited');
  msg.text = req.body.text;
  msg.editedAt = new Date();
  await msg.save();
  logger.info('Message edited', { messageId: String(msg._id), userId: req.user.id });
  res.json({ message: await broadcastMessageUpdate(msg, conv) });
}

export async function deleteMessage(req, res) {
  const { msg, conv } = await loadMessageForMember(req.params.messageId, req.user.id);
  const { scope } = req.q;

  if (scope === 'me') {
    await Message.updateOne({ _id: msg._id }, { $addToSet: { hiddenFor: req.user.id } });
    emitToUsers([req.user.id], 'message:hidden', { conversationId: String(conv._id), messageId: String(msg._id) });
    logger.info('Message deleted for me', { messageId: String(msg._id), userId: req.user.id });
    return res.json({ ok: true });
  }

  if (String(msg.senderId) !== req.user.id) throw forbidden('You can only delete your own messages for everyone');
  if (msg.type === 'system') throw badRequest('System messages cannot be deleted');
  if (msg.deletedAt) return res.json({ message: msg.toJSON() });
  const ageMinutes = (Date.now() - msg.createdAt.getTime()) / 60000;
  if (ageMinutes > env.DELETE_FOR_EVERYONE_MINUTES) {
    throw forbidden(`Messages can only be deleted for everyone within ${env.DELETE_FOR_EVERYONE_MINUTES} minutes`);
  }

  const mediaIds = [msg.mediaId, msg.thumbnailId].filter(Boolean);
  Object.assign(msg, {
    text: '',
    mediaId: null,
    thumbnailId: null,
    mediaUrl: null,
    thumbnailUrl: null,
    fileName: null,
    fileSize: null,
    mimeType: null,
    provider: null,
    providerId: null,
    reactions: [],
    deletedAt: new Date(),
  });
  await msg.save();
  // Remove the stored file unless a forwarded copy still references it.
  logger.info('Message deleted for everyone', { messageId: String(msg._id), conversationId: String(conv._id), userId: req.user.id });
  for (const id of mediaIds) {
    const stillUsed = await Message.exists({ $or: [{ mediaId: id }, { thumbnailId: id }] });
    if (!stillUsed) await deleteFile(id);
  }
  if (conv.pinnedMessages.some((id) => String(id) === String(msg._id))) {
    await Conversation.updateOne({ _id: conv._id }, { $pull: { pinnedMessages: msg._id } });
    emitToUsers(conv.memberIds(), 'conversation:updated', { conversation: { _id: conv._id }, refetch: true });
  }
  res.json({ message: await broadcastMessageUpdate(msg, conv) });
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
