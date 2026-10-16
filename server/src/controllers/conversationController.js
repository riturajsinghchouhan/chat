import { z } from 'zod';
import { Conversation, directKeyFor } from '../models/Conversation.js';
import { Message, MESSAGE_POPULATE } from '../models/Message.js';
import { User } from '../models/User.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';
import {
  CONVERSATION_POPULATE,
  loadConversationForMember,
  serializeConversation,
} from '../services/conversationService.js';
import { emitToUsers } from '../socket/io.js';
import { logger } from '../utils/logger.js';

export const schemas = {
  create: z.object({ userId: objectId }),
  idParam: z.object({ conversationId: objectId }),
  prefs: z
    .object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() })
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  media: z.object({
    type: z.enum(['image', 'file', 'gif', 'all']).default('all'),
    before: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(60),
  }),
  pin: z.object({ messageId: objectId }),
};

export async function createDirect(req, res) {
  const me = req.user.id;
  const { userId } = req.body;
  if (userId === me) throw badRequest('You cannot start a chat with yourself');
  const [meUser, other] = await Promise.all([
    User.findById(me).select('blockedUsers'),
    User.findById(userId).select('blockedUsers'),
  ]);
  if (!other) throw notFound('User not found');
  if (other.blockedUsers.some((id) => String(id) === me)) throw forbidden('You cannot message this user', 'BLOCKED');
  if (meUser.blockedUsers.some((id) => String(id) === userId)) {
    throw forbidden('Unblock this user to start a chat', 'BLOCKED');
  }

  const key = directKeyFor(me, userId);
  // Upsert keeps this idempotent and race-safe thanks to the unique directKey index.
  let conv;
  try {
    conv = await Conversation.findOneAndUpdate(
      { directKey: key },
      {
        $setOnInsert: {
          type: 'direct',
          directKey: key,
          createdBy: me,
          members: [{ user: me }, { user: userId }],
          lastMessageAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
    conv = await Conversation.findOne({ directKey: key });
  }
  await conv.populate(CONVERSATION_POPULATE);
  logger.info('Direct conversation opened', { conversationId: String(conv._id), userId: me, otherUserId: userId });
  res.status(201).json({ conversation: serializeConversation(conv, me) });
}

export async function listConversations(req, res) {
  const me = req.user.id;
  const convs = await Conversation.find({
    'members.user': me,
    // Empty direct chats are only visible to whoever opened them.
    $or: [{ type: 'group' }, { lastMessage: { $ne: null } }, { createdBy: me }],
  })
    .sort({ lastMessageAt: -1 })
    .limit(300)
    .populate(CONVERSATION_POPULATE);
  res.json({ conversations: convs.map((c) => serializeConversation(c, me)) });
}

export async function getConversation(req, res) {
  const conv = await loadConversationForMember(req.params.conversationId, req.user.id);
  res.json({ conversation: serializeConversation(conv, req.user.id) });
}

export async function updatePrefs(req, res) {
  const set = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`members.$.${k}`, v]));
  const conv = await Conversation.findOneAndUpdate(
    { _id: req.params.conversationId, 'members.user': req.user.id },
    { $set: set },
    { returnDocument: 'after' },
  ).populate(CONVERSATION_POPULATE);
  if (!conv) throw notFound('Conversation not found');
  const conversation = serializeConversation(conv, req.user.id);
  // Sync the user's other tabs/devices.
  emitToUsers([req.user.id], 'conversation:prefs', { conversationId: String(conv._id), me: conversation.me });
  res.json({ conversation });
}

export async function listMedia(req, res) {
  await loadConversationForMember(req.params.conversationId, req.user.id, { populate: false });
  const { type, before, limit } = req.q;
  const filter = {
    conversationId: req.params.conversationId,
    deletedAt: null,
    hiddenFor: { $ne: req.user.id },
    type: type === 'all' ? { $in: ['image', 'file', 'gif'] } : type,
  };
  if (before) filter._id = { $lt: before };
  const messages = await Message.find(filter).sort({ _id: -1 }).limit(limit).populate(MESSAGE_POPULATE);
  res.json({ messages: messages.map((m) => m.toJSON()), hasMore: messages.length === limit });
}

export async function togglePin(req, res) {
  const conv = await loadConversationForMember(req.params.conversationId, req.user.id, { populate: false });
  const msg = await Message.findOne({ _id: req.body.messageId, conversationId: conv._id, deletedAt: null });
  if (!msg || msg.type === 'system') throw notFound('Message not found');
  const pinned = conv.pinnedMessages.some((id) => String(id) === String(msg._id));
  if (pinned) {
    conv.pinnedMessages = conv.pinnedMessages.filter((id) => String(id) !== String(msg._id));
  } else {
    if (conv.pinnedMessages.length >= 10) throw badRequest('You can pin up to 10 messages');
    conv.pinnedMessages.push(msg._id);
  }
  await conv.save();
  logger.info(pinned ? 'Message unpinned' : 'Message pinned', { conversationId: String(conv._id), messageId: String(msg._id), userId: req.user.id });
  await conv.populate(CONVERSATION_POPULATE);
  const conversation = serializeConversation(conv);
  emitToUsers(conv.memberIds(), 'conversation:updated', {
    conversation: { _id: conversation._id, pinnedMessages: conversation.pinnedMessages },
  });
  res.json({ pinned: !pinned, pinnedMessages: conversation.pinnedMessages });
}
