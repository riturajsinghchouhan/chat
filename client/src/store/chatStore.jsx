import { create } from 'zustand';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { emitAck, getSocket } from '../lib/socket';
import { applyDelivered, applyRead, mergeMessages } from '../lib/messages';
import { uploadChunked } from '../lib/chunkedUpload';
import { conversationDisplay, idOf, messagePreview, uid } from '../lib/utils';
import { playMessageSound, showBrowserNotification } from '../lib/notify';
import { useAuth } from './authStore';

const PAGE = 30;
const meId = () => useAuth.getState().user?._id;

// Files waiting to be uploaded / re-uploaded, keyed by clientId (not reactive state).
const pendingUploads = new Map();
const inflightConversations = new Map();
const readTimers = new Map();
const typingTimers = new Map();

const emptyThread = { items: [], hasMore: true, loading: false, loaded: false, error: null };

function isRetryable(err) {
  const status = err?.response?.status ?? err?.error?.status;
  return !status || status >= 500 || status === 429;
}

export async function uploadMedia(conversationId, file, onProgress) {
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('file', file, file.name || 'upload');
  const { data } = await api.post('/media/upload', form, {
    timeout: 120000,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return data.media;
}

export const useChat = create((set, get) => ({
  conversations: {},
  convStatus: 'idle', // idle | loading | ready | error
  threads: {},
  activeId: null,
  typing: {}, // convId -> { userId: true }
  presence: {}, // userId -> { isOnline, lastSeen }
  notifications: [],
  unreadNotifications: 0,
  connection: 'connecting', // connecting | online | offline

  reset() {
    pendingUploads.clear();
    set({
      conversations: {},
      convStatus: 'idle',
      threads: {},
      activeId: null,
      typing: {},
      presence: {},
      notifications: [],
      unreadNotifications: 0,
    });
  },

  setConnection: (connection) => set({ connection }),

  // ---------------- Conversations ----------------
  async loadConversations() {
    if (get().convStatus === 'idle') set({ convStatus: 'loading' });
    try {
      const { data } = await api.get('/conversations');
      const conversations = {};
      const presence = { ...get().presence };
      for (const c of data.conversations) {
        conversations[c._id] = c;
        for (const m of c.members) if (m.user?._id) presence[m.user._id] = { isOnline: m.user.isOnline, lastSeen: m.user.lastSeen };
      }
      set({ conversations, presence, convStatus: 'ready' });
    } catch (err) {
      if (get().convStatus !== 'ready') set({ convStatus: 'error' });
      throw err;
    }
  },

  upsertConversation(conv) {
    set((s) => {
      const prev = s.conversations[conv._id];
      const merged = { ...prev, ...conv, me: conv.me || prev?.me };
      const presence = { ...s.presence };
      for (const m of merged.members || []) {
        if (m.user?._id && m.user.isOnline !== undefined && !presence[m.user._id]) {
          presence[m.user._id] = { isOnline: m.user.isOnline, lastSeen: m.user.lastSeen };
        }
      }
      return { conversations: { ...s.conversations, [conv._id]: merged }, presence };
    });
  },

  async fetchConversation(id) {
    if (inflightConversations.has(id)) return inflightConversations.get(id);
    const p = api
      .get(`/conversations/${id}`)
      .then(({ data }) => {
        get().upsertConversation(data.conversation);
        return data.conversation;
      })
      .finally(() => inflightConversations.delete(id));
    inflightConversations.set(id, p);
    return p;
  },

  removeConversation(id) {
    set((s) => {
      const conversations = { ...s.conversations };
      const threads = { ...s.threads };
      delete conversations[id];
      delete threads[id];
      return { conversations, threads };
    });
  },

  async startDirect(userId) {
    const { data } = await api.post('/conversations', { userId });
    get().upsertConversation(data.conversation);
    return data.conversation;
  },

  async updatePrefs(id, prefs) {
    const prev = get().conversations[id];
    if (prev) get().upsertConversation({ ...prev, me: { ...prev.me, ...prefs } });
    try {
      const { data } = await api.patch(`/conversations/${id}`, prefs);
      get().upsertConversation(data.conversation);
    } catch (err) {
      if (prev) get().upsertConversation(prev);
      toast.error(getErrorMessage(err));
    }
  },

  setActive(id) {
    set({ activeId: id });
    if (id) get().markRead(id);
  },

  // ---------------- Messages ----------------
  setThread(id, patch) {
    set((s) => ({ threads: { ...s.threads, [id]: { ...emptyThread, ...s.threads[id], ...patch } } }));
  },

  async loadMessages(id, { force = false } = {}) {
    const thread = get().threads[id];
    if (!force && (thread?.loaded || thread?.loading)) return;
    get().setThread(id, { loading: true, error: null });
    try {
      const { data } = await api.get(`/messages/${id}`, { params: { limit: PAGE } });
      const current = get().threads[id]?.items || [];
      const items = mergeMessages(force ? current : current.filter((m) => m.status === 'sending' || m.status === 'failed'), data.messages);
      get().setThread(id, { items, hasMore: force && thread?.loaded ? thread.hasMore : data.hasMore, loaded: true, loading: false });
      for (const m of data.messages) if (idOf(m.senderId) !== meId() && m.status === 'sent') getSocket()?.emit('message:delivered', { messageIds: [m._id] });
    } catch (err) {
      get().setThread(id, { loading: false, error: getErrorMessage(err) });
    }
  },

  async loadOlder(id) {
    const thread = get().threads[id];
    if (!thread || thread.loading || !thread.hasMore) return 0;
    const oldest = thread.items.find((m) => !m.clientId || m.status !== 'sending');
    if (!oldest) return 0;
    get().setThread(id, { loading: true });
    try {
      const { data } = await api.get(`/messages/${id}`, { params: { limit: PAGE, before: oldest._id } });
      get().setThread(id, { items: mergeMessages(get().threads[id].items, data.messages), hasMore: data.hasMore, loading: false });
      return data.messages.length;
    } catch (err) {
      get().setThread(id, { loading: false });
      toast.error(getErrorMessage(err, 'Could not load older messages'));
      return 0;
    }
  },

  upsertMessages(convId, messages) {
    const thread = get().threads[convId];
    if (!thread) return; // never opened: history is fetched when the chat is opened
    get().setThread(convId, { items: mergeMessages(thread.items, messages) });
  },

  patchLocalMessage(convId, key, patch) {
    const thread = get().threads[convId];
    if (!thread) return;
    get().setThread(convId, {
      items: thread.items.map((m) => (m._id === key || m.clientId === key ? { ...m, ...patch } : m)),
    });
  },

  removeLocalMessage(convId, key) {
    const thread = get().threads[convId];
    if (!thread) return;
    const msg = thread.items.find((m) => m._id === key || m.clientId === key);
    if (msg?.localPreview) URL.revokeObjectURL(msg.localPreview);
    if (msg?.posterPreview) URL.revokeObjectURL(msg.posterPreview);
    const pending = pendingUploads.get(key);
    // Free the server-side chunks of an unfinished video upload.
    if (pending?.upload?.uploadId && !pending.media) api.delete(`/media/uploads/${pending.upload.uploadId}`).catch(() => {});
    pendingUploads.delete(key);
    get().setThread(convId, { items: thread.items.filter((m) => m !== msg) });
  },

  /** Applies server copies of existing messages (edits, reactions, deletions). */
  applyMessageUpdates(convId, messages) {
    const byId = new Map(messages.map((m) => [m._id, m]));
    const thread = get().threads[convId];
    if (thread) {
      get().setThread(convId, {
        items: thread.items.map((m) => (byId.has(m._id) ? { ...byId.get(m._id), localPreview: m.localPreview, posterPreview: m.posterPreview } : m)),
      });
    }
    const conv = get().conversations[convId];
    if (conv?.lastMessage && byId.has(conv.lastMessage._id)) get().upsertConversation({ ...conv, lastMessage: byId.get(conv.lastMessage._id) });
  },

  hideLocalMessages(convId, ids) {
    const thread = get().threads[convId];
    if (!thread) return;
    const hidden = new Set(ids.map(String));
    get().setThread(convId, { items: thread.items.filter((m) => !hidden.has(String(m._id))) });
  },

  /** Deletes several messages at once. scope: 'me' (hide for me) | 'everyone'. Throws on failure. */
  async deleteMessages(convId, ids, scope) {
    const { data } = await api.post('/messages/bulk-delete', { conversationId: convId, messageIds: ids, scope });
    if (scope === 'me') get().hideLocalMessages(convId, ids);
    else get().applyMessageUpdates(convId, data.messages);
  },

  /**
   * Optimistic send. `file` → uploaded here with progress (bubble shows retry on failure);
   * videos go through the resumable chunked upload with `videoMeta` + `poster`.
   * `media` → already uploaded (camera flow). `gif` → provider metadata.
   */
  sendMessage(convId, { type = 'text', text = '', file, media, gif, replyTo, localPreview, videoMeta, poster }) {
    const me = useAuth.getState().user;
    const clientId = uid();
    const optimistic = {
      _id: clientId,
      clientId,
      conversationId: convId,
      senderId: { _id: me._id, name: me.name, username: me.username, avatar: me.avatar },
      type,
      text,
      status: 'sending',
      createdAt: new Date().toISOString(),
      reactions: [],
      readBy: [],
      deliveredTo: [],
      replyTo: replyTo || null,
    };
    if (file) {
      Object.assign(optimistic, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        localPreview: type === 'image' || type === 'video' ? URL.createObjectURL(file) : null,
        uploadProgress: 0,
      });
      if (type === 'video') {
        Object.assign(optimistic, {
          duration: videoMeta?.duration,
          width: videoMeta?.width,
          height: videoMeta?.height,
          posterPreview: poster ? URL.createObjectURL(poster) : null,
        });
      }
      pendingUploads.set(clientId, { file, videoMeta, poster, upload: {} });
    }
    if (media) {
      Object.assign(optimistic, { ...media, localPreview });
      pendingUploads.set(clientId, { media });
    }
    if (gif) {
      Object.assign(optimistic, {
        gif,
        provider: 'giphy',
        mediaUrl: gif.url,
        thumbnailUrl: gif.previewUrl,
        width: gif.width,
        height: gif.height,
      });
    }

    const thread = get().threads[convId];
    get().setThread(convId, { items: [...(thread?.items || []), optimistic] });
    const conv = get().conversations[convId];
    if (conv) get().upsertConversation({ ...conv, lastMessage: optimistic, lastMessageAt: optimistic.createdAt });
    return get().deliver(convId, clientId);
  },

  async deliver(convId, clientId) {
    const msg = get().threads[convId]?.items.find((m) => m.clientId === clientId);
    if (!msg) return null;
    get().patchLocalMessage(convId, clientId, { status: 'sending', error: null });
    const pending = pendingUploads.get(clientId);

    try {
      if (pending?.file && !pending.media) {
        const onProgress = (p) => get().patchLocalMessage(convId, clientId, { uploadProgress: p });
        pending.media =
          msg.type === 'video'
            ? await uploadChunked({
                conversationId: convId,
                file: pending.file,
                meta: pending.videoMeta,
                poster: pending.poster,
                onProgress,
                state: pending.upload, // resumes from the last uploaded chunk on retry
              })
            : await uploadMedia(convId, pending.file, onProgress);
      }
      const payload = {
        clientId,
        conversationId: convId,
        type: msg.type,
        text: msg.text || '',
        replyTo: msg.replyTo?._id || null,
      };
      if (pending?.media) payload.mediaId = pending.media.mediaId;
      if (msg.type === 'gif') payload.gif = msg.gif;

      let saved;
      try {
        saved = (await emitAck('message:send', payload)).message;
      } catch (socketErr) {
        // Socket offline or ack timed out → idempotent REST fallback (same clientId = no duplicates).
        if (socketErr.error) throw socketErr;
        saved = (await api.post('/messages', payload)).data.message;
      }
      pendingUploads.delete(clientId);
      get().upsertMessages(convId, [saved]);
      const conv = get().conversations[convId];
      if (conv && (!conv.lastMessage || conv.lastMessage.clientId === clientId || new Date(saved.createdAt) >= new Date(conv.lastMessageAt))) {
        get().upsertConversation({ ...conv, lastMessage: saved, lastMessageAt: saved.createdAt });
      }
      return saved;
    } catch (err) {
      const message = getErrorMessage(err, 'Message not sent');
      get().patchLocalMessage(convId, clientId, { status: 'failed', error: message, retryable: isRetryable(err) });
      if (!isRetryable(err)) toast.error(message);
      return null;
    }
  },

  retryFailed() {
    for (const [convId, thread] of Object.entries(get().threads)) {
      for (const m of thread.items) if (m.status === 'failed' && m.retryable) get().deliver(convId, m.clientId);
    }
  },

  markRead(convId) {
    clearTimeout(readTimers.get(convId));
    readTimers.set(
      convId,
      setTimeout(async () => {
        const conv = get().conversations[convId];
        if (!conv) return;
        if (conv.me) get().upsertConversation({ ...conv, me: { ...conv.me, unreadCount: 0 } });
        try {
          await emitAck('conversation:read', { conversationId: convId });
        } catch {
          api.post(`/conversations/${convId}/read`).catch(() => {});
        }
      }, 300),
    );
  },

  // ---------------- Notifications ----------------
  async loadNotifications() {
    try {
      const { data } = await api.get('/notifications');
      set({ notifications: data.notifications, unreadNotifications: data.unread });
    } catch {
      /* non-critical */
    }
  },
  async markAllNotificationsRead() {
    set((s) => ({ unreadNotifications: 0, notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
    await api.patch('/notifications/read-all').catch(() => {});
  },
  async markNotificationRead(id) {
    set((s) => ({
      notifications: s.notifications.map((n) => (n._id === id ? { ...n, read: true } : n)),
      unreadNotifications: Math.max(0, s.unreadNotifications - (s.notifications.find((n) => n._id === id && !n.read) ? 1 : 0)),
    }));
    await api.patch(`/notifications/${id}/read`).catch(() => {});
  },

  // ---------------- Socket wiring ----------------
  attachSocket(socket, { navigate }) {
    const s = get;
    let lostConnection = false;

    socket.on('connect', () => {
      set({ connection: 'online' });
      if (lostConnection) {
        lostConnection = false;
        // Resync anything missed while disconnected.
        s().loadConversations().catch(() => {});
        const active = s().activeId;
        set((st) => {
          const threads = {};
          for (const [id, t] of Object.entries(st.threads)) threads[id] = id === active ? t : { ...t, loaded: false };
          return { threads };
        });
        if (active) s().loadMessages(active, { force: true });
        s().retryFailed();
      }
    });
    socket.on('disconnect', () => {
      lostConnection = true;
      set({ connection: 'offline' });
    });
    socket.io.on('reconnect_attempt', () => set({ connection: 'connecting' }));

    socket.on('message:new', ({ message }) => {
      const convId = idOf(message.conversationId);
      const mine = idOf(message.senderId) === meId();
      s().upsertMessages(convId, [message]);
      const conv = s().conversations[convId];
      if (!conv) {
        s().fetchConversation(convId).catch(() => {});
      } else {
        const isActive = s().activeId === convId && document.visibilityState === 'visible';
        const unread = !mine && !isActive && message.type !== 'system' ? (conv.me?.unreadCount || 0) + 1 : conv.me?.unreadCount || 0;
        s().upsertConversation({ ...conv, lastMessage: message, lastMessageAt: message.createdAt, me: conv.me && { ...conv.me, unreadCount: unread } });
      }
      if (mine) return;
      socket.emit('message:delivered', { messageIds: [message._id] });
      if (s().activeId === convId && document.visibilityState === 'visible') s().markRead(convId);
      if (message.type !== 'system') s().notifyIncoming(convId, message, navigate);
      // A message arriving means they stopped typing.
      s().setTyping(convId, idOf(message.senderId), false);
    });

    socket.on('message:updated', ({ message }) => s().applyMessageUpdates(idOf(message.conversationId), [message]));
    socket.on('messages:updated', ({ conversationId, messages }) => s().applyMessageUpdates(conversationId, messages));

    socket.on('message:hidden', ({ conversationId, messageId, messageIds }) => {
      s().hideLocalMessages(conversationId, messageIds || [messageId]);
    });

    socket.on('message:delivered', ({ conversationId, messageIds, userId, deliveredAt }) => {
      const thread = s().threads[conversationId];
      if (thread) s().setThread(conversationId, { items: applyDelivered(thread.items, messageIds, userId, deliveredAt) });
      const conv = s().conversations[conversationId];
      if (conv?.lastMessage && messageIds.includes(conv.lastMessage._id) && conv.lastMessage.status === 'sent') {
        s().upsertConversation({ ...conv, lastMessage: { ...conv.lastMessage, status: 'delivered' } });
      }
    });

    socket.on('message:read', ({ conversationId, userId, readAt, isGroup }) => {
      const conv = s().conversations[conversationId];
      if (!conv) return;
      if (userId === meId()) {
        // Read on another tab/device of mine
        if (conv.me) s().upsertConversation({ ...conv, me: { ...conv.me, unreadCount: 0 } });
        return;
      }
      const opts = { meId: meId(), readerId: userId, readAt, isGroup, memberCount: conv.members.length };
      const thread = s().threads[conversationId];
      if (thread) s().setThread(conversationId, { items: applyRead(thread.items, opts) });
      const members = conv.members.map((m) => (idOf(m.user) === userId ? { ...m, lastReadAt: readAt } : m));
      const [last] = conv.lastMessage ? applyRead([conv.lastMessage], opts) : [conv.lastMessage];
      s().upsertConversation({ ...conv, members, lastMessage: last });
    });

    socket.on('typing:start', ({ conversationId, userId }) => s().setTyping(conversationId, userId, true));
    socket.on('typing:stop', ({ conversationId, userId }) => s().setTyping(conversationId, userId, false));

    socket.on('user:online', ({ userId }) => set((st) => ({ presence: { ...st.presence, [userId]: { isOnline: true, lastSeen: new Date().toISOString() } } })));
    socket.on('user:offline', ({ userId, lastSeen }) => set((st) => ({ presence: { ...st.presence, [userId]: { isOnline: false, lastSeen } } })));

    socket.on('user:updated', ({ user }) => {
      if (user._id === meId()) useAuth.getState().patchUser(user);
      set((st) => {
        const conversations = {};
        for (const [id, c] of Object.entries(st.conversations)) {
          conversations[id] = c.members.some((m) => idOf(m.user) === user._id)
            ? { ...c, members: c.members.map((m) => (idOf(m.user) === user._id ? { ...m, user: { ...m.user, ...user } } : m)) }
            : c;
        }
        return { conversations };
      });
    });

    socket.on('user:deleted', ({ userId }) => {
      set((st) => {
        const conversations = {};
        for (const [id, c] of Object.entries(st.conversations)) {
          conversations[id] = c.type === 'direct' && c.members.some((m) => idOf(m.user) === userId)
            ? { ...c, members: c.members.map((m) => (idOf(m.user) === userId ? { ...m, user: null } : m)) }
            : c;
        }
        return { conversations };
      });
    });

    socket.on('user:blocked', ({ userId, blocked }) => {
      const me = useAuth.getState().user;
      if (!me) return;
      const list = (me.blockedUsers || []).map(String).filter((id) => id !== userId);
      useAuth.getState().patchUser({ blockedUsers: blocked ? [...list, userId] : list });
    });

    socket.on('conversation:new', ({ conversation }) => s().upsertConversation(conversation));
    socket.on('conversation:updated', ({ conversation, refetch }) => {
      if (s().conversations[conversation._id]) s().upsertConversation(conversation);
      if (refetch) s().fetchConversation(conversation._id).catch(() => {});
    });
    socket.on('conversation:prefs', ({ conversationId, me }) => {
      const conv = s().conversations[conversationId];
      if (conv) s().upsertConversation({ ...conv, me });
    });
    socket.on('conversation:removed', ({ conversationId, reason }) => {
      const conv = s().conversations[conversationId];
      s().removeConversation(conversationId);
      if (reason === 'removed' && conv) toast(`You were removed from "${conv.name}"`);
      if (s().activeId === conversationId) navigate('/');
    });

    socket.on('notification:new', ({ notification }) => {
      set((st) => ({ notifications: [notification, ...st.notifications].slice(0, 50), unreadNotifications: st.unreadNotifications + 1 }));
      toast(notification.text, { icon: '🔔' });
    });
  },

  setTyping(convId, userId, on) {
    const key = `${convId}:${userId}`;
    clearTimeout(typingTimers.get(key));
    set((st) => {
      const current = { ...(st.typing[convId] || {}) };
      if (on) current[userId] = true;
      else delete current[userId];
      return { typing: { ...st.typing, [convId]: current } };
    });
    // Safety net in case the "stop" event is lost.
    if (on) typingTimers.set(key, setTimeout(() => get().setTyping(convId, userId, false), 6000));
  },

  notifyIncoming(convId, message, navigate) {
    const conv = get().conversations[convId];
    const settings = useAuth.getState().user?.settings || {};
    if (!conv || conv.me?.muted) return;
    const isActive = get().activeId === convId && document.visibilityState === 'visible';
    if (isActive) return;
    if (settings.sound !== false) playMessageSound();
    const display = conversationDisplay(conv, meId());
    const sender = message.senderId?.name || 'Someone';
    const title = conv.type === 'group' ? `${sender} · ${display.name}` : sender;
    const body = settings.messagePreview === false ? 'New message' : messagePreview({ ...message, senderId: null }, meId());
    if (document.visibilityState === 'hidden' && settings.notifications !== false) {
      showBrowserNotification({ title, body, tag: convId, onClick: () => navigate(`/c/${convId}`) });
    } else {
      toast(
        (t) => (
          <button
            type="button"
            className="max-w-64 text-left"
            onClick={() => {
              toast.dismiss(t.id);
              navigate(`/c/${convId}`);
            }}
          >
            <div className="text-sm font-semibold">{title}</div>
            <div className="truncate text-xs opacity-80">{body}</div>
          </button>
        ),
        { icon: '💬', id: `msg-${convId}` },
      );
    }
  },
}));
