// Pure helpers for merging message lists. Kept framework-free so they are easy to unit test.
import { idOf } from './utils';

const STATUS_RANK = { failed: -1, sending: 0, sent: 1, delivered: 2, read: 3 };

const byTime = (a, b) => {
  const diff = new Date(a.createdAt) - new Date(b.createdAt);
  if (diff !== 0) return diff;
  return String(a._id) < String(b._id) ? -1 : 1;
};

/**
 * Merge incoming server messages into a list without duplicates.
 * A server copy replaces its optimistic twin (matched by clientId); a lower status never
 * overwrites a higher one (e.g. a late ack must not undo a "read" receipt).
 */
export function mergeMessages(list, incoming) {
  if (!incoming.length) return list;
  const next = [...list];
  for (const msg of incoming) {
    const idx = next.findIndex(
      (m) => String(m._id) === String(msg._id) || (msg.clientId && m.clientId === msg.clientId && idOf(m.senderId) === idOf(msg.senderId)),
    );
    if (idx === -1) {
      next.push(msg);
      continue;
    }
    const prev = next[idx];
    const keepStatus = (STATUS_RANK[prev.status] ?? 0) > (STATUS_RANK[msg.status] ?? 0) && prev.status !== 'failed';
    next[idx] = {
      ...msg,
      status: keepStatus ? prev.status : msg.status,
      readBy: (prev.readBy?.length || 0) > (msg.readBy?.length || 0) ? prev.readBy : msg.readBy,
      localPreview: prev.localPreview,
    };
  }
  return next.sort(byTime);
}

export function applyDelivered(list, messageIds, userId, at) {
  const ids = new Set(messageIds.map(String));
  return list.map((m) => {
    if (!ids.has(String(m._id))) return m;
    const deliveredTo = (m.deliveredTo || []).some((d) => idOf(d.user) === userId)
      ? m.deliveredTo
      : [...(m.deliveredTo || []), { user: userId, at }];
    return { ...m, deliveredTo, status: (STATUS_RANK[m.status] ?? 0) < STATUS_RANK.delivered ? 'delivered' : m.status };
  });
}

export function applyRead(list, { meId, readerId, readAt, isGroup, memberCount }) {
  const t = new Date(readAt);
  return list.map((m) => {
    if (idOf(m.senderId) !== meId || m.type === 'system' || new Date(m.createdAt) > t) return m;
    if (m.status === 'sending' || m.status === 'failed') return m;
    const readBy = (m.readBy || []).some((r) => idOf(r.user) === readerId) ? m.readBy : [...(m.readBy || []), { user: readerId, at: readAt }];
    const allRead = !isGroup || readBy.length >= Math.max(memberCount - 1, 1);
    return { ...m, readBy, status: allRead ? 'read' : (STATUS_RANK[m.status] ?? 0) < STATUS_RANK.delivered ? 'delivered' : m.status };
  });
}
