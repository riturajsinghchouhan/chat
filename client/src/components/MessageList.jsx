import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, MessagesSquare } from 'lucide-react';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import { formatDayLabel, idOf, isSameDay } from '../lib/utils';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { MessageSkeleton, Spinner } from './LoadingSkeleton';
import EmptyState from './EmptyState';

const EMPTY = [];

export default function MessageList({ conversation, meId, onReply, onEdit }) {
  const convId = conversation._id;
  const thread = useChat((s) => s.threads[convId]);
  const typingMap = useChat((s) => s.typing[convId]);
  const jumpTo = useUI((s) => s.jumpTo);
  const containerRef = useRef(null);
  const anchorRef = useRef(null); // preserves position while older messages are prepended
  const stickRef = useRef(true);
  const initialScrollDone = useRef(false);
  const [newCount, setNewCount] = useState(0);
  const [highlightId, setHighlightId] = useState(null);

  // Snapshot of read state when the chat was opened (drives the "unread messages" divider).
  const [divider] = useState(() => ({ lastReadAt: conversation.me?.lastReadAt, unread: conversation.me?.unreadCount || 0 }));

  const items = thread?.items || EMPTY;
  const isGroup = conversation.type === 'group';

  const firstUnreadId = useMemo(() => {
    if (!divider.unread || !divider.lastReadAt) return null;
    const t = new Date(divider.lastReadAt);
    return items.find((m) => idOf(m.senderId) !== meId && m.type !== 'system' && new Date(m.createdAt) > t)?._id || null;
  }, [items, divider, meId]);

  const gallery = useMemo(
    () =>
      items
        .filter((m) => m.type === 'image' && !m.deletedAt && m.mediaUrl && m.status !== 'sending')
        .map((m) => ({ id: m._id, src: m.mediaUrl, caption: m.text, fileName: m.fileName })),
    [items],
  );

  const nearBottom = () => {
    const el = containerRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewCount(0);
  }, []);

  // Initial position: unread divider or bottom.
  useLayoutEffect(() => {
    if (!thread?.loaded || initialScrollDone.current) return;
    initialScrollDone.current = true;
    const target = firstUnreadId && document.getElementById('unread-divider');
    if (target) target.scrollIntoView({ block: 'start' });
    else scrollToBottom();
  }, [thread?.loaded, firstUnreadId, scrollToBottom]);

  // React to list changes: keep anchor when prepending, follow bottom when appending.
  const lastId = items[items.length - 1]?._id;
  const firstId = items[0]?._id;
  const prevFirst = useRef(firstId);
  const prevLast = useRef(lastId);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (anchorRef.current && firstId !== prevFirst.current) {
      el.scrollTop = el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    } else if (lastId !== prevLast.current && initialScrollDone.current) {
      const last = items[items.length - 1];
      if (stickRef.current || idOf(last?.senderId) === meId) scrollToBottom(true);
      else setNewCount((n) => n + 1);
    }
    prevFirst.current = firstId;
    prevLast.current = lastId;
  }, [firstId, lastId, items, meId, scrollToBottom]);

  const loadOlder = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return 0;
    anchorRef.current = el.scrollHeight - el.scrollTop;
    const n = await useChat.getState().loadOlder(convId);
    if (!n) anchorRef.current = null;
    return n;
  }, [convId]);

  const onScroll = () => {
    const el = containerRef.current;
    stickRef.current = nearBottom();
    if (stickRef.current) setNewCount(0);
    if (el.scrollTop < 80 && thread?.hasMore && !thread?.loading) loadOlder();
  };

  // Jump to a specific message (reply quote, pinned, search result), paging back if needed.
  const jump = useCallback(
    async (messageId) => {
      for (let i = 0; i < 20; i += 1) {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setHighlightId(messageId);
          setTimeout(() => setHighlightId(null), 1800);
          return;
        }
        const t = useChat.getState().threads[convId];
        if (!t?.hasMore) break;
        const n = await loadOlder();
        if (!n) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
    },
    [convId, loadOlder],
  );

  useEffect(() => {
    if (jumpTo?.conversationId === convId && thread?.loaded) jump(jumpTo.messageId);
  }, [jumpTo, convId, thread?.loaded, jump]);

  const typingUsers = Object.keys(typingMap || {}).filter((id) => id !== meId);
  const typingLabel = isGroup && typingUsers.length
    ? `${typingUsers
        .map((id) => conversation.members.find((m) => idOf(m.user) === id)?.user?.name?.split(' ')[0])
        .filter(Boolean)
        .join(', ')} typing…`
    : null;

  if (!thread || (!thread.loaded && thread.loading) || (!thread.loaded && !thread.error)) return <div className="flex-1"><MessageSkeleton /></div>;
  if (thread.error && !thread.loaded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>{thread.error}</p>
        <button type="button" className="btn-ghost" onClick={() => useChat.getState().loadMessages(convId, { force: true })}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={onScroll} className="scroll-thin h-full overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-6" data-testid="message-list">
        {thread.loading && thread.loaded && (
          <div className="flex justify-center py-2 text-accent">
            <Spinner />
          </div>
        )}
        {!thread.hasMore && items.length > 0 && <p className="pb-4 text-center text-xs text-muted">This is the beginning of your conversation</p>}
        {items.length === 0 && (
          <EmptyState icon={MessagesSquare} title="No messages yet" description="Say hello 👋 — messages are delivered instantly." />
        )}

        {items.map((m, i) => {
          const prev = items[i - 1];
          const next = items[i + 1];
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const sameSenderAsPrev = prev && !newDay && prev.type !== 'system' && idOf(prev.senderId) === idOf(m.senderId);
          const sameSenderAsNext = next && next.type !== 'system' && isSameDay(next.createdAt, m.createdAt) && idOf(next.senderId) === idOf(m.senderId);
          return (
            <Fragment key={m.clientId || m._id /* stable across optimistic → persisted swap */}>
              {newDay && (
                <div className="sticky top-0 z-10 my-4 flex justify-center">
                  <span className="neu-sm rounded-full px-4 py-1.5 text-xs font-semibold text-muted">{formatDayLabel(m.createdAt)}</span>
                </div>
              )}
              {m._id === firstUnreadId && (
                <div id="unread-divider" className="my-4 flex items-center gap-3 text-xs font-semibold text-accent">
                  <div className="h-px flex-1 bg-accent/40" />
                  {divider.unread} unread message{divider.unread === 1 ? '' : 's'}
                  <div className="h-px flex-1 bg-accent/40" />
                </div>
              )}
              {m.type === 'system' ? (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-accent-soft px-4 py-1.5 text-center text-xs text-muted">{m.text}</span>
                </div>
              ) : (
                <MessageBubble
                  message={m}
                  meId={meId}
                  mine={idOf(m.senderId) === meId}
                  isGroup={isGroup}
                  showSender={!sameSenderAsPrev}
                  showAvatar={!sameSenderAsNext}
                  conversation={conversation}
                  onReply={onReply}
                  onEdit={onEdit}
                  onJump={jump}
                  highlighted={highlightId === m._id}
                  galleryItems={gallery}
                />
              )}
            </Fragment>
          );
        })}
        {typingUsers.length > 0 && (
          <div className="mt-2">
            <TypingIndicator label={typingLabel} />
          </div>
        )}
      </div>

      {newCount > 0 && (
        <button type="button" onClick={() => scrollToBottom(true)} className="neu-accent animate-pop absolute right-5 bottom-4 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold">
          <ArrowDown size={14} /> {newCount} new
        </button>
      )}
    </div>
  );
}
