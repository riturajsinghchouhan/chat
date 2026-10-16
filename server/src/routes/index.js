import express, { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { authLimiter, chunkLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../utils/validate.js';
import { env } from '../config/env.js';

import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as convs from '../controllers/conversationController.js';
import * as messages from '../controllers/messageController.js';
import * as media from '../controllers/mediaController.js';
import * as groups from '../controllers/groupController.js';
import * as notifications from '../controllers/notificationController.js';
import * as gifs from '../controllers/gifController.js';

export const router = Router();

// Health
router.get('/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp, uptime: Math.round(process.uptime()) });
});

// Auth
const a = Router();
a.post('/register', authLimiter, validate({ body: auth.schemas.register }), auth.register);
a.post('/login', authLimiter, validate({ body: auth.schemas.login }), auth.login);
a.post('/logout', auth.logout);
a.post('/refresh', auth.refresh);
a.post('/forgot-password', authLimiter, validate({ body: auth.schemas.forgot }), auth.forgotPassword);
a.post('/reset-password', authLimiter, validate({ body: auth.schemas.reset }), auth.resetPassword);
a.post('/change-password', requireAuth, authLimiter, validate({ body: auth.schemas.changePassword }), auth.changePassword);
a.get('/me', requireAuth, auth.me);
router.use('/auth', a);

// Users
const u = Router();
u.use(requireAuth);
u.get('/search', validate({ query: users.schemas.search }), users.searchUsers);
u.get('/blocked', users.listBlocked);
u.patch('/profile', validate({ body: users.schemas.profile }), users.updateProfile);
u.patch('/settings', validate({ body: users.schemas.settings }), users.updateSettings);
u.post('/avatar', uploadLimiter, uploadSingle('avatar', 5), users.uploadAvatar);
u.delete('/avatar', users.removeAvatar);
u.delete('/me', authLimiter, validate({ body: users.schemas.deleteAccount }), users.deleteAccount);
u.get('/:userId', validate({ params: users.schemas.userIdParam }), users.getUser);
u.post('/:userId/block', validate({ params: users.schemas.userIdParam }), users.blockUser);
u.delete('/:userId/block', validate({ params: users.schemas.userIdParam }), users.unblockUser);
router.use('/users', u);

// Conversations
const c = Router();
c.use(requireAuth);
c.post('/', validate({ body: convs.schemas.create }), convs.createDirect);
c.get('/', convs.listConversations);
c.get('/:conversationId', validate({ params: convs.schemas.idParam }), convs.getConversation);
c.patch('/:conversationId', validate({ params: convs.schemas.idParam, body: convs.schemas.prefs }), convs.updatePrefs);
c.get('/:conversationId/media', validate({ params: convs.schemas.idParam, query: convs.schemas.media }), convs.listMedia);
c.post('/:conversationId/pins', validate({ params: convs.schemas.idParam, body: convs.schemas.pin }), convs.togglePin);
c.post('/:conversationId/read', validate({ params: messages.schemas.convParam }), messages.markRead);
router.use('/conversations', c);

// Messages
const m = Router();
m.use(requireAuth);
m.get('/search', validate({ query: messages.schemas.searchAll }), messages.searchAllMessages);
m.get('/item/:messageId', validate({ params: messages.schemas.idParam }), messages.getMessage);
m.get('/:conversationId', validate({ params: messages.schemas.convParam, query: messages.schemas.list }), messages.listMessages);
m.post('/', validate({ body: messages.schemas.send }), messages.createMessage);
m.post('/bulk-delete', validate({ body: messages.schemas.bulkRemove }), messages.bulkDeleteMessages);
m.patch('/:messageId', validate({ params: messages.schemas.idParam, body: messages.schemas.edit }), messages.editMessage);
m.delete('/:messageId', validate({ params: messages.schemas.idParam, query: messages.schemas.remove }), messages.deleteMessage);
m.post('/:messageId/reactions', validate({ params: messages.schemas.idParam, body: messages.schemas.react }), messages.reactToMessage);
m.post('/:messageId/forward', validate({ params: messages.schemas.idParam, body: messages.schemas.forward }), messages.forwardMessage);
router.use('/messages', m);

// Media (GridFS)
router.post('/media/upload', requireAuth, uploadLimiter, uploadSingle('file'), validate({ body: media.schemas.upload }), media.uploadMedia);
router.get('/media/:mediaId', optionalAuth, validate({ params: media.schemas.idParam, query: media.schemas.get }), media.getMedia);
router.get('/media/:mediaId/link', requireAuth, validate({ params: media.schemas.idParam }), media.getMediaLink);

// Resumable chunked uploads (videos): init → PUT each chunk (any order, retryable) → complete
const up = Router();
up.use(requireAuth);
up.post('/', uploadLimiter, validate({ body: media.schemas.initUpload }), media.initUpload);
up.get('/:uploadId', validate({ params: media.schemas.uploadParam }), media.getUploadStatus);
up.put(
  '/:uploadId/chunks/:index',
  chunkLimiter,
  validate({ params: media.schemas.chunkParam }),
  express.raw({ type: 'application/octet-stream', limit: env.UPLOAD_CHUNK_BYTES }),
  media.uploadChunk,
);
up.post('/:uploadId/complete', validate({ params: media.schemas.uploadParam }), uploadSingle('poster', 5), media.completeUpload);
up.delete('/:uploadId', validate({ params: media.schemas.uploadParam }), media.abortUpload);
router.use('/media/uploads', up);

// Groups
const g = Router();
g.use(requireAuth);
g.post('/', validate({ body: groups.schemas.create }), groups.createGroup);
g.get('/:groupId', validate({ params: groups.schemas.groupParam }), groups.getGroup);
g.patch('/:groupId', validate({ params: groups.schemas.groupParam, body: groups.schemas.update }), groups.updateGroup);
g.post('/:groupId/avatar', uploadLimiter, validate({ params: groups.schemas.groupParam }), uploadSingle('avatar', 5), groups.uploadGroupAvatar);
g.post('/:groupId/members', validate({ params: groups.schemas.groupParam, body: groups.schemas.addMembers }), groups.addMembers);
g.patch('/:groupId/members/:userId', validate({ params: groups.schemas.memberParam, body: groups.schemas.role }), groups.setMemberRole);
g.delete('/:groupId/members/:userId', validate({ params: groups.schemas.memberParam }), groups.removeMember);
router.use('/groups', g);

// Notifications
const n = Router();
n.use(requireAuth);
n.get('/', notifications.listNotifications);
n.patch('/read-all', notifications.markAllNotificationsRead);
n.patch('/:notificationId/read', validate({ params: notifications.schemas.idParam }), notifications.markNotificationRead);
router.use('/notifications', n);

// GIFs (GIPHY proxy)
router.get('/gifs/trending', requireAuth, validate({ query: gifs.schemas.trending }), gifs.trending);
router.get('/gifs/search', requireAuth, validate({ query: gifs.schemas.search }), gifs.search);
