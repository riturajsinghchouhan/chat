import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User, PUBLIC_USER_FIELDS } from '../models/User.js';
import { Session } from '../models/Session.js';
import { Conversation } from '../models/Conversation.js';
import { Notification } from '../models/Notification.js';
import { AppError, badRequest, conflict, notFound } from '../utils/AppError.js';
import { escapeRegex, objectId } from '../utils/validate.js';
import { usernameSchema } from './authController.js';
import { deleteFile, deleteFilesOwnedBy, detectFile, idFromMediaUrl, mediaUrl, processAvatar, saveBuffer } from '../services/storage.js';
import { contactIdsOf } from '../services/conversationService.js';
import { releaseWallpaperImage, resolveWallpaper, saveWallpaperImage, wallpaperInput } from '../services/wallpaperService.js';
import { disconnectUser, emitToUsers } from '../socket/io.js';
import { REFRESH_COOKIE, refreshCookieOptions } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';

export const schemas = {
  search: z.object({ q: z.string().trim().min(1).max(50) }),
  userIdParam: z.object({ userId: objectId }),
  profile: z
    .object({
      name: z.string().trim().min(1).max(60).optional(),
      username: usernameSchema.optional(),
      bio: z.string().trim().max(200).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  settings: z
    .object({
      notifications: z.boolean().optional(),
      sound: z.boolean().optional(),
      messagePreview: z.boolean().optional(),
      wallpaper: wallpaperInput.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  deleteAccount: z.object({ password: z.string().min(1).max(128) }),
};

async function broadcastProfile(user) {
  const contacts = await contactIdsOf(user._id);
  const pub = {
    _id: user._id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
  };
  emitToUsers([...contacts, String(user._id)], 'user:updated', { user: pub });
}

export async function searchUsers(req, res) {
  const q = escapeRegex(req.q.q.replace(/^@/, ''));
  const users = await User.find({
    _id: { $ne: req.user.id },
    blockedUsers: { $ne: req.user.id }, // hide people who blocked me
    $or: [{ username: { $regex: `^${q}`, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }],
  })
    .select(PUBLIC_USER_FIELDS)
    .limit(20)
    .lean();
  res.json({ users });
}

export async function getUser(req, res) {
  const user = await User.findById(req.params.userId).select(`${PUBLIC_USER_FIELDS} blockedUsers createdAt`).lean();
  if (!user) throw notFound('User not found');
  const me = await User.findById(req.user.id).select('blockedUsers').lean();
  const blockedMe = user.blockedUsers.some((id) => String(id) === req.user.id);
  const { blockedUsers: _b, ...pub } = user;
  if (blockedMe) {
    pub.isOnline = false;
    pub.lastSeen = null;
  }
  res.json({
    user: pub,
    isBlocked: me.blockedUsers.some((id) => String(id) === String(user._id)),
    blockedMe,
  });
}

export async function listBlocked(req, res) {
  const me = await User.findById(req.user.id).populate('blockedUsers', PUBLIC_USER_FIELDS).lean();
  res.json({ users: me?.blockedUsers ?? [] });
}

export async function updateProfile(req, res) {
  if (req.body.username) {
    const taken = await User.exists({ username: req.body.username, _id: { $ne: req.user.id } });
    if (taken) throw conflict('Username is already taken', 'USERNAME_TAKEN');
  }
  const user = await User.findByIdAndUpdate(req.user.id, { $set: req.body }, { returnDocument: 'after', runValidators: true });
  if (!user) throw notFound('User not found');
  await broadcastProfile(user);
  logger.info('Profile updated', { userId: req.user.id, fields: Object.keys(req.body) });
  res.json({ user });
}

export async function updateSettings(req, res) {
  const body = { ...req.body };
  let previousImage = null;
  if ('wallpaper' in body) {
    body.wallpaper = await resolveWallpaper(req.user.id, body.wallpaper);
    previousImage = (await User.findById(req.user.id).select('settings.wallpaper').lean())?.settings?.wallpaper?.mediaId;
  }
  const set = Object.fromEntries(Object.entries(body).map(([k, v]) => [`settings.${k}`, v]));
  const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { returnDocument: 'after' });
  if (previousImage && String(previousImage) !== String(body.wallpaper?.mediaId)) await releaseWallpaperImage(req.user.id, previousImage);
  // Sync the user's other tabs/devices.
  emitToUsers([req.user.id], 'user:updated', { user: { _id: user._id, settings: user.settings } });
  res.json({ user });
}

export async function uploadWallpaper(req, res) {
  res.status(201).json({ media: await saveWallpaperImage(req.user.id, req.file) });
}

export async function uploadAvatar(req, res) {
  if (!req.file) throw badRequest('Choose an image to upload');
  const detected = await detectFile(req.file.buffer, req.file.originalname);
  if (detected?.kind !== 'image') throw badRequest('Avatar must be a JPEG, PNG, WebP or GIF image', 'INVALID_FILE_TYPE');
  if (req.file.size > 5 * 1024 * 1024) throw new AppError(413, 'Avatar must be 5 MB or smaller', 'FILE_TOO_LARGE');
  const buffer = await processAvatar(req.file.buffer);
  const id = await saveBuffer(buffer, {
    filename: `avatar-${req.user.id}.webp`,
    contentType: 'image/webp',
    metadata: { kind: 'avatar', ownerId: req.user.id },
  });
  const user = await User.findById(req.user.id);
  const oldId = idFromMediaUrl(user.avatar);
  user.avatar = mediaUrl(id);
  await user.save();
  await deleteFile(oldId);
  await broadcastProfile(user);
  logger.info('Avatar updated', { userId: req.user.id, fileId: String(id) });
  res.json({ user });
}

export async function removeAvatar(req, res) {
  const user = await User.findById(req.user.id);
  const oldId = idFromMediaUrl(user.avatar);
  user.avatar = null;
  await user.save();
  await deleteFile(oldId);
  await broadcastProfile(user);
  res.json({ user });
}

export async function blockUser(req, res) {
  const { userId } = req.params;
  if (userId === req.user.id) throw badRequest('You cannot block yourself');
  if (!(await User.exists({ _id: userId }))) throw notFound('User not found');
  await User.updateOne({ _id: req.user.id }, { $addToSet: { blockedUsers: userId } });
  emitToUsers([req.user.id], 'user:blocked', { userId, blocked: true });
  logger.info('User blocked', { userId: req.user.id, blockedUserId: userId });
  res.json({ ok: true, blocked: true });
}

export async function unblockUser(req, res) {
  await User.updateOne({ _id: req.user.id }, { $pull: { blockedUsers: req.params.userId } });
  emitToUsers([req.user.id], 'user:blocked', { userId: req.params.userId, blocked: false });
  logger.info('User unblocked', { userId: req.user.id, unblockedUserId: req.params.userId });
  res.json({ ok: true, blocked: false });
}

export async function deleteAccount(req, res) {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw notFound('User not found');
  const ok = await bcrypt.compare(req.body.password, user.passwordHash);
  if (!ok) {
    logger.warn('Account deletion failed: wrong password', { userId: req.user.id });
    throw new AppError(400, 'Password is incorrect', 'INVALID_PASSWORD');
  }

  // Leave every group, handing admin rights over when needed.
  const groups = await Conversation.find({ type: 'group', 'members.user': user._id });
  for (const group of groups) {
    group.members = group.members.filter((m) => String(m.user) !== String(user._id));
    if (group.members.length && !group.members.some((m) => m.role === 'admin')) {
      group.members[0].role = 'admin';
    }
    await group.save();
    emitToUsers(group.memberIds(), 'conversation:updated', {
      conversation: { _id: group._id, members: group.members.map(({ user: u, role, joinedAt, lastReadAt }) => ({ user: u, role, joinedAt, lastReadAt })) },
      refetch: true,
    });
  }
  // Direct conversations and messages stay so the other person keeps their history;
  // the sender simply renders as "Deleted account".
  await Promise.all([
    Session.deleteMany({ user: user._id }),
    Notification.deleteMany({ user: user._id }),
    User.updateMany({ blockedUsers: user._id }, { $pull: { blockedUsers: user._id } }),
    deleteFile(idFromMediaUrl(user.avatar)),
    deleteFilesOwnedBy(user._id, 'wallpaper'),
  ]);
  const contacts = await contactIdsOf(user._id);
  await user.deleteOne();
  logger.info('Account deleted', { userId: String(user._id), groupsLeft: groups.length });
  emitToUsers(contacts, 'user:deleted', { userId: String(user._id) });
  disconnectUser(user._id);
  const { maxAge: _m, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
  res.json({ ok: true });
}
