import { Conversation } from '../models/Conversation.js';
import { PUBLIC_USER_FIELDS } from '../models/User.js';
import { notFound } from '../utils/AppError.js';

export const CONVERSATION_POPULATE = [
  { path: 'members.user', select: PUBLIC_USER_FIELDS },
  { path: 'lastMessage', populate: { path: 'senderId', select: 'name username' } },
  {
    path: 'pinnedMessages',
    select: 'text type senderId fileName createdAt deletedAt',
    populate: { path: 'senderId', select: 'name username' },
  },
];

/**
 * Shapes a conversation for a client. Per-member preferences (pinned/archived/muted/unread)
 * are only returned for the requesting user under `me`.
 */
export function serializeConversation(conv, userId = null) {
  const obj = typeof conv.toJSON === 'function' ? conv.toJSON() : conv;
  const members = obj.members.map((m) => ({
    user: m.user,
    role: m.role,
    joinedAt: m.joinedAt,
    lastReadAt: m.lastReadAt,
  }));
  const result = {
    _id: obj._id,
    type: obj.type,
    name: obj.name,
    description: obj.description,
    avatar: obj.avatar,
    createdBy: obj.createdBy,
    lastMessage: obj.lastMessage,
    lastMessageAt: obj.lastMessageAt,
    pinnedMessages: obj.pinnedMessages,
    settings: obj.settings,
    members,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
  if (userId) {
    const me = obj.members.find((m) => String(m.user?._id ?? m.user) === String(userId));
    if (me) {
      result.me = {
        role: me.role,
        unreadCount: me.unreadCount,
        pinned: me.pinned,
        archived: me.archived,
        muted: me.muted,
        lastReadAt: me.lastReadAt,
      };
    }
  }
  return result;
}

/** Loads a conversation only if `userId` is a member. Non-members get a 404 (no existence leak). */
export async function loadConversationForMember(conversationId, userId, { populate = true } = {}) {
  let query = Conversation.findOne({ _id: conversationId, 'members.user': userId });
  if (populate) query = query.populate(CONVERSATION_POPULATE);
  const conv = await query;
  if (!conv) throw notFound('Conversation not found');
  return conv;
}

export async function populateConversation(conv) {
  return conv.populate(CONVERSATION_POPULATE);
}

/** All user ids that share at least one conversation with `userId`. */
export async function contactIdsOf(userId) {
  const ids = await Conversation.find({ 'members.user': userId }).distinct('members.user');
  return ids.map(String).filter((id) => id !== String(userId));
}
