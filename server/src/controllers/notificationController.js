import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { notFound } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';

export const schemas = {
  idParam: z.object({ notificationId: objectId }),
};

export async function listNotifications(req, res) {
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('actor', 'name username avatar');
  const unread = await Notification.countDocuments({ user: req.user.id, read: false });
  res.json({ notifications, unread });
}

export async function markNotificationRead(req, res) {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, user: req.user.id },
    { $set: { read: true } },
    { returnDocument: 'after' },
  );
  if (!n) throw notFound('Notification not found');
  res.json({ notification: n });
}

export async function markAllNotificationsRead(req, res) {
  await Notification.updateMany({ user: req.user.id, read: false }, { $set: { read: true } });
  res.json({ ok: true });
}
