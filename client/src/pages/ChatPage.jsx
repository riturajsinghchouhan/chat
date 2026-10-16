import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessageSquareOff, Pin, Trash2, X } from 'lucide-react';
import { useChat } from '../store/chatStore';
import { useAuth } from '../store/authStore';
import { useUI } from '../store/uiStore';
import { conversationDisplay, messagePreview } from '../lib/utils';
import ChatHeader from '../components/ChatHeader';
import MessageList from '../components/MessageList';
import MessageComposer from '../components/MessageComposer';
import ConversationInfoPanel from '../components/ConversationInfoPanel';
import DeleteMessagesDialog from '../components/DeleteMessagesDialog';
import WallpaperModal from '../components/WallpaperModal';
import { effectiveWallpaper } from '../lib/wallpapers';
import EmptyState from '../components/EmptyState';
import { MessageSkeleton } from '../components/LoadingSkeleton';

function PinnedBar({ conversation }) {
  const pins = (conversation.pinnedMessages || []).filter((p) => p && typeof p === 'object' && !p.deletedAt);
  const [index, setIndex] = useState(0);
  if (!pins.length) return null;
  const pin = pins[pins.length - 1 - (index % pins.length)];
  return (
    <button
      type="button"
      onClick={() => {
        useUI.getState().requestJump(conversation._id, pin._id);
        setIndex((i) => i + 1);
      }}
      className="flex w-full items-center gap-3 border-b border-line px-5 py-2 text-left text-sm hover:bg-accent-soft/40"
    >
      <Pin size={15} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-accent">
          Pinned message{pins.length > 1 ? ` ${(index % pins.length) + 1}/${pins.length}` : ''}
        </div>
        <div className="truncate text-muted">{messagePreview({ ...pin, senderId: null })}</div>
      </div>
    </button>
  );
}

const EMPTY = [];

function SelectionBar({ count, onCancel, onDelete }) {
  return (
    <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
      <button type="button" className="icon-btn neu-sm" onClick={onCancel} aria-label="Cancel selection">
        <X size={18} />
      </button>
      <div className="min-w-0 flex-1 py-2.5 font-bold" aria-live="polite">
        {count} selected
      </div>
      <button type="button" className="icon-btn neu-sm text-accent" onClick={onDelete} disabled={!count} aria-label="Delete selected messages" title="Delete">
        <Trash2 size={18} />
      </button>
    </header>
  );
}

function Conversation({ conversation, me }) {
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'info' | 'search'
  const [selection, setSelection] = useState(null); // Set of message ids while selecting
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const items = useChat((s) => s.threads[conversation._id]?.items || EMPTY);

  const toggleSelect = useCallback((id) => {
    setSelection((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size ? next : null;
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelection(null);
    setConfirmDelete(false);
  }, []);

  // Only messages still in the thread (others may have been deleted meanwhile).
  const selectedMessages = useMemo(() => (selection ? items.filter((m) => selection.has(m._id)) : EMPTY), [items, selection]);
  useEffect(() => {
    if (selection && !selectedMessages.length && !confirmDelete) setSelection(null);
  }, [selection, selectedMessages.length, confirmDelete]);

  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (e) => e.key === 'Escape' && !confirmDelete && clearSelection();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selection, confirmDelete, clearSelection]);

  useEffect(() => {
    const chat = useChat.getState();
    chat.setActive(conversation._id);
    chat.loadMessages(conversation._id);
    return () => {
      if (useChat.getState().activeId === conversation._id) useChat.getState().setActive(null);
    };
  }, [conversation._id]);

  const display = conversationDisplay(conversation, me._id);
  const blockedByMe = display.user && (me.blockedUsers || []).map(String).includes(display.user._id);
  let disabledReason = null;
  if (conversation.type === 'direct' && display.deleted) disabledReason = 'This account no longer exists.';
  else if (blockedByMe) disabledReason = 'You blocked this contact. Unblock them from the chat menu to send messages.';
  else if (conversation.type === 'group' && conversation.settings?.adminsOnlyMessages && conversation.me?.role !== 'admin') disabledReason = 'Only admins can send messages in this group.';

  return (
    <div className="flex h-full w-full">
      <section className="flex h-full min-w-0 flex-1 flex-col bg-base">
        {selection ? (
          <SelectionBar count={selectedMessages.length} onCancel={clearSelection} onDelete={() => setConfirmDelete(true)} />
        ) : (
          <ChatHeader
            conversation={conversation}
            onOpenInfo={() => setPanel((p) => (p === 'info' ? null : 'info'))}
            onOpenSearch={() => setPanel('search')}
            onOpenWallpaper={() => setWallpaperOpen(true)}
          />
        )}
        <PinnedBar conversation={conversation} />
        <MessageList
          conversation={conversation}
          meId={me._id}
          onReply={(m) => {
            setEditing(null);
            setReplyTo(m);
          }}
          onEdit={(m) => {
            setReplyTo(null);
            setEditing(m);
          }}
          selection={selection}
          onToggleSelect={toggleSelect}
          wallpaper={effectiveWallpaper(conversation, me)}
        />
        <MessageComposer
          conversationId={conversation._id}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          disabledReason={disabledReason}
        />
      </section>
      <DeleteMessagesDialog
        open={confirmDelete}
        conversationId={conversation._id}
        messages={selectedMessages}
        meId={me._id}
        onClose={() => setConfirmDelete(false)}
        onDeleted={clearSelection}
      />
      <WallpaperModal open={wallpaperOpen} onClose={() => setWallpaperOpen(false)} conversation={conversation} />
      {panel && (
        <>
          <div className="fixed inset-0 z-40 bg-[var(--overlay)] xl:hidden" onClick={() => setPanel(null)} aria-hidden="true" />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm animate-pop xl:static xl:z-auto xl:w-[360px] xl:max-w-none xl:animate-none">
            <ConversationInfoPanel key={panel} conversation={conversation} initialTab={panel} onClose={() => setPanel(null)} />
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { conversationId } = useParams();
  const me = useAuth((s) => s.user);
  const conversation = useChat((s) => s.conversations[conversationId]);
  const convStatus = useChat((s) => s.convStatus);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    if (!conversation && convStatus === 'ready') {
      useChat
        .getState()
        .fetchConversation(conversationId)
        .catch(() => setMissing(true));
    }
  }, [conversationId, conversation, convStatus]);

  if (conversation) return <Conversation key={conversationId} conversation={conversation} me={me} />;
  if (missing) {
    return (
      <EmptyState
        icon={MessageSquareOff}
        title="Conversation not available"
        description="It may have been removed, or you are no longer a member."
        action={
          <Link to="/" className="btn-primary">
            <X size={16} /> Back to chats
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex h-full w-full flex-col">
      <div className="h-[73px] border-b border-line" />
      <MessageSkeleton />
    </div>
  );
}

