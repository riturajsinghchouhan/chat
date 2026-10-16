export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const idOf = (v) => (v && typeof v === 'object' ? String(v._id) : v ? String(v) : null);

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatListTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

export function formatDayLabel(date) {
  const d = new Date(date);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const isSameDay = (a, b) => sameDay(new Date(a), new Date(b));

export function formatLastSeen(date) {
  if (!date) return 'offline';
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'last seen just now';
  if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)} min ago`;
  if (sameDay(d, new Date())) return `last seen today at ${formatTime(d)}`;
  return `last seen ${formatListTime(d)}${diff < 6 * 86400000 ? ` at ${formatTime(d)}` : ''}`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Display info (name/avatar/user) for a conversation from the viewer's point of view. */
export function conversationDisplay(conv, meId) {
  if (!conv) return { name: '', avatar: null, user: null };
  if (conv.type === 'group') return { name: conv.name || 'Group', avatar: conv.avatar, user: null, isGroup: true };
  const other = conv.members.find((m) => idOf(m.user) !== meId)?.user;
  if (!other || typeof other !== 'object') return { name: 'Deleted account', avatar: null, user: null, deleted: true };
  return { name: other.name, avatar: other.avatar, user: other };
}

export function messagePreview(msg, meId) {
  if (!msg) return '';
  if (msg.deletedAt) return 'This message was deleted';
  const prefix = msg.type !== 'system' && idOf(msg.senderId) === meId ? 'You: ' : '';
  switch (msg.type) {
    case 'image':
      return `${prefix}📷 ${msg.text || 'Photo'}`;
    case 'video':
      return `${prefix}🎥 ${msg.text || 'Video'}`;
    case 'gif':
      return `${prefix}GIF`;
    case 'file':
      return `${prefix}📄 ${msg.fileName || 'File'}`;
    case 'system':
      return msg.text;
    default:
      return `${prefix}${msg.text}`;
  }
}

export const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
