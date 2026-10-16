import { Notification } from '../models/Notification.js';
import { emitToUsers } from '../socket/io.js';

export async function notifyUsers(userIds, { type, actor, conversationId, text }) {
  const recipients = [...new Set(userIds.map(String))].filter((id) => id !== String(actor));
  if (!recipients.length) return;
  const docs = await Notification.insertMany(
    recipients.map((user) => ({ user, type, actor, conversationId, text })),
  );
  for (const doc of docs) {
    await doc.populate({ path: 'actor', select: 'name username avatar' });
    emitToUsers([doc.user], 'notification:new', { notification: doc.toJSON() });
  }
}
