import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { AppError, badRequest, forbidden, notFound } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';
import {
  CONVERSATION_POPULATE,
  loadConversationForMember,
  serializeConversation,
} from '../services/conversationService.js';
import { createSystemMessage } from '../services/messageService.js';
import { notifyUsers } from '../services/notificationService.js';
import { deleteFile, detectFile, idFromMediaUrl, mediaUrl, processAvatar, saveBuffer } from '../services/storage.js';
import { emitToUsers } from '../socket/io.js';
import { logger } from '../utils/logger.js';

const MAX_MEMBERS = 256;

export const schemas = {
  create: z.object({
    name: z.string().trim().min(1, 'Group name is required').max(80),
    description: z.string().trim().max(300).optional().default(''),
    memberIds: z.array(objectId).min(1, 'Add at least one member').max(MAX_MEMBERS - 1),
  }),
  groupParam: z.object({ groupId: objectId }),
  memberParam: z.object({ groupId: objectId, userId: objectId }),
  update: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(300).optional(),
      adminsOnlyMessages: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  addMembers: z.object({ userIds: z.array(objectId).min(1).max(MAX_MEMBERS - 1) }),
  role: z.object({ role: z.enum(['admin', 'member']) }),
};

async function loadGroup(groupId, userId) {
  const conv = await loadConversationForMember(groupId, userId, { populate: false });
  if (conv.type !== 'group') throw notFound('Group not found');
  return conv;
}

function requireAdmin(conv, userId) {
  if (conv.getMember(userId)?.role !== 'admin') throw forbidden('Only group admins can do that', 'NOT_ADMIN');
}

async function displayName(userId) {
  const u = await User.findById(userId).select('name').lean();
  return u?.name || 'Someone';
}

/** Users that exist and have not blocked `actorId`. */
async function eligibleUsers(ids, actorId) {
  return User.find({ _id: { $in: ids, $ne: actorId }, blockedUsers: { $ne: actorId } }).select('name').lean();
}

async function broadcastGroup(conv) {
  const fresh = await Conversation.findById(conv._id).populate(CONVERSATION_POPULATE);
  emitToUsers(fresh.memberIds(), 'conversation:updated', { conversation: serializeConversation(fresh) });
  return fresh;
}

async function sendNewConversation(conv, userIds) {
  const fresh = await Conversation.findById(conv._id).populate(CONVERSATION_POPULATE);
  for (const id of userIds) {
    emitToUsers([id], 'conversation:new', { conversation: serializeConversation(fresh, id) });
  }
  return fresh;
}

export async function createGroup(req, res) {
  const me = req.user.id;
  const { name, description, memberIds } = req.body;
  const users = await eligibleUsers([...new Set(memberIds)], me);
  if (!users.length) throw badRequest('None of the selected users can be added');

  const conv = await Conversation.create({
    type: 'group',
    name,
    description,
    createdBy: me,
    members: [{ user: me, role: 'admin' }, ...users.map((u) => ({ user: u._id }))],
  });
  const actor = await displayName(me);
  logger.info('Group created', { groupId: String(conv._id), userId: me, members: conv.members.length });
  await createSystemMessage(conv, me, `${actor} created the group "${name}"`);
  const fresh = await sendNewConversation(conv, conv.memberIds());
  await notifyUsers(users.map((u) => u._id), {
    type: 'group_added',
    actor: me,
    conversationId: conv._id,
    text: `${actor} added you to "${name}"`,
  });
  res.status(201).json({
    conversation: serializeConversation(fresh, me),
    skipped: memberIds.length - users.length,
  });
}

export async function getGroup(req, res) {
  const conv = await loadGroup(req.params.groupId, req.user.id);
  await conv.populate(CONVERSATION_POPULATE);
  res.json({ conversation: serializeConversation(conv, req.user.id) });
}

export async function updateGroup(req, res) {
  const me = req.user.id;
  const conv = await loadGroup(req.params.groupId, me);
  requireAdmin(conv, me);
  const { name, description, adminsOnlyMessages } = req.body;
  const actor = await displayName(me);
  const changes = [];
  if (name !== undefined && name !== conv.name) {
    changes.push(`${actor} renamed the group to "${name}"`);
    conv.name = name;
  }
  if (description !== undefined && description !== conv.description) {
    changes.push(`${actor} updated the group description`);
    conv.description = description;
  }
  if (adminsOnlyMessages !== undefined && adminsOnlyMessages !== conv.settings.adminsOnlyMessages) {
    changes.push(
      adminsOnlyMessages ? `${actor} allowed only admins to send messages` : `${actor} allowed all members to send messages`,
    );
    conv.settings.adminsOnlyMessages = adminsOnlyMessages;
  }
  await conv.save();
  logger.info('Group updated', { groupId: String(conv._id), userId: me, fields: Object.keys(req.body) });
  for (const text of changes) await createSystemMessage(conv, me, text);
  const fresh = await broadcastGroup(conv);
  res.json({ conversation: serializeConversation(fresh, me) });
}

export async function uploadGroupAvatar(req, res) {
  const me = req.user.id;
  const conv = await loadGroup(req.params.groupId, me);
  requireAdmin(conv, me);
  if (!req.file) throw badRequest('Choose an image to upload');
  const detected = await detectFile(req.file.buffer, req.file.originalname);
  if (detected?.kind !== 'image') throw badRequest('Group photo must be an image', 'INVALID_FILE_TYPE');
  if (req.file.size > 5 * 1024 * 1024) throw new AppError(413, 'Image must be 5 MB or smaller', 'FILE_TOO_LARGE');
  const id = await saveBuffer(await processAvatar(req.file.buffer), {
    filename: `group-${conv._id}.webp`,
    contentType: 'image/webp',
    metadata: { kind: 'avatar', ownerId: me, conversationId: conv._id },
  });
  const oldId = idFromMediaUrl(conv.avatar);
  conv.avatar = mediaUrl(id);
  await conv.save();
  await deleteFile(oldId);
  await createSystemMessage(conv, me, `${await displayName(me)} changed the group photo`);
  const fresh = await broadcastGroup(conv);
  res.json({ conversation: serializeConversation(fresh, me) });
}

export async function addMembers(req, res) {
  const me = req.user.id;
  const conv = await loadGroup(req.params.groupId, me);
  requireAdmin(conv, me);
  const current = new Set(conv.memberIds());
  const candidates = [...new Set(req.body.userIds)].filter((id) => !current.has(id));
  const users = await eligibleUsers(candidates, me);
  if (!users.length) throw badRequest('No new members to add');
  if (conv.members.length + users.length > MAX_MEMBERS) throw badRequest(`Groups can have up to ${MAX_MEMBERS} members`);

  conv.members.push(...users.map((u) => ({ user: u._id, lastReadAt: new Date() })));
  await conv.save();
  logger.info('Group members added', { groupId: String(conv._id), userId: me, added: users.map((u) => String(u._id)) });
  const actor = await displayName(me);
  await createSystemMessage(conv, me, `${actor} added ${users.map((u) => u.name).join(', ')}`);
  await sendNewConversation(conv, users.map((u) => String(u._id)));
  const fresh = await broadcastGroup(conv);
  await notifyUsers(users.map((u) => u._id), {
    type: 'group_added',
    actor: me,
    conversationId: conv._id,
    text: `${actor} added you to "${conv.name}"`,
  });
  res.json({ conversation: serializeConversation(fresh, me) });
}

export async function removeMember(req, res) {
  const me = req.user.id;
  const { userId } = req.params;
  const conv = await loadGroup(req.params.groupId, me);
  const leaving = userId === me;
  if (!leaving) requireAdmin(conv, me);
  const target = conv.getMember(userId);
  if (!target) throw notFound('Member not found');

  conv.members = conv.members.filter((m) => String(m.user) !== userId);
  if (conv.members.length && !conv.members.some((m) => m.role === 'admin')) {
    // Never leave a group without an admin: promote the longest-standing member.
    conv.members.sort((a, b) => a.joinedAt - b.joinedAt);
    conv.members[0].role = 'admin';
  }
  await conv.save();

  logger.info(leaving ? 'Group member left' : 'Group member removed', { groupId: String(conv._id), userId: me, targetUserId: userId });
  emitToUsers([userId], 'conversation:removed', { conversationId: String(conv._id), reason: leaving ? 'left' : 'removed' });
  const targetName = await displayName(userId);
  if (conv.members.length) {
    const actor = await displayName(me);
    await createSystemMessage(conv, me, leaving ? `${targetName} left the group` : `${actor} removed ${targetName}`);
    await broadcastGroup(conv);
  }
  if (!leaving) {
    await notifyUsers([userId], {
      type: 'group_removed',
      actor: me,
      conversationId: conv._id,
      text: `You were removed from "${conv.name}"`,
    });
  }
  res.json({ ok: true });
}

export async function setMemberRole(req, res) {
  const me = req.user.id;
  const { userId } = req.params;
  const conv = await loadGroup(req.params.groupId, me);
  requireAdmin(conv, me);
  const target = conv.getMember(userId);
  if (!target) throw notFound('Member not found');
  if (req.body.role === 'member' && conv.members.filter((m) => m.role === 'admin').length === 1 && target.role === 'admin') {
    throw badRequest('A group needs at least one admin');
  }
  target.role = req.body.role;
  await conv.save();
  logger.info('Group role changed', { groupId: String(conv._id), userId: me, targetUserId: userId, role: req.body.role });
  const fresh = await broadcastGroup(conv);
  if (req.body.role === 'admin' && userId !== me) {
    await notifyUsers([userId], {
      type: 'group_admin',
      actor: me,
      conversationId: conv._id,
      text: `You are now an admin of "${conv.name}"`,
    });
  }
  res.json({ conversation: serializeConversation(fresh, me) });
}
