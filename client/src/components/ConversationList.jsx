import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowLeft, MessageSquarePlus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { cn, conversationDisplay } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useDebounce } from '../hooks/useDebounce';
import ConversationItem from './ConversationItem';
import UserAvatar from './UserAvatar';
import EmptyState from './EmptyState';
import { ConversationSkeleton } from './LoadingSkeleton';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['groups', 'Groups'],
  ['direct', 'Direct'],
];

export default function ConversationList({ meId, onNewChat }) {
  const navigate = useNavigate();
  const conversations = useChat((s) => s.conversations);
  const convStatus = useChat((s) => s.convStatus);
  const [filter, setFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 300);
  const [people, setPeople] = useState([]);

  useEffect(() => {
    if (!q) {
      setPeople([]);
      return undefined;
    }
    let cancelled = false;
    api
      .get('/users/search', { params: { q } })
      .then(({ data }) => !cancelled && setPeople(data.users))
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const all = useMemo(() => Object.values(conversations), [conversations]);
  const archivedCount = all.filter((c) => c.me?.archived).length;

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((c) => Boolean(c.me?.archived) === showArchived)
      .filter((c) => (filter === 'unread' ? c.me?.unreadCount > 0 : filter === 'groups' ? c.type === 'group' : filter === 'direct' ? c.type === 'direct' : true))
      .filter((c) => {
        if (!needle) return true;
        const d = conversationDisplay(c, meId);
        return d.name.toLowerCase().includes(needle) || d.user?.username?.toLowerCase().includes(needle);
      })
      .sort((a, b) => (Number(Boolean(b.me?.pinned)) - Number(Boolean(a.me?.pinned))) || new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }, [all, filter, showArchived, query, meId]);

  const directIds = new Set(all.filter((c) => c.type === 'direct').map((c) => conversationDisplay(c, meId).user?._id));
  const newPeople = people.filter((p) => !directIds.has(p._id));

  const startChat = async (user) => {
    try {
      const conv = await useChat.getState().startDirect(user._id);
      setQuery('');
      navigate(`/c/${conv._id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 px-4 pb-3">
        <label className="neu-inset flex items-center gap-2 rounded-full px-4 py-3">
          <Search size={17} className="text-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Search chats or people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search chats or people"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-muted hover:text-accent">
              <X size={16} />
            </button>
          )}
        </label>
        {!showArchived && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition', filter === key ? 'neu-accent' : 'neu-sm text-muted hover:text-fg')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {showArchived ? (
          <button type="button" onClick={() => setShowArchived(false)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-accent hover:bg-accent-soft/40">
            <ArrowLeft size={18} /> Archived chats
          </button>
        ) : (
          archivedCount > 0 && (
            <button type="button" onClick={() => setShowArchived(true)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm hover:bg-accent-soft/40">
              <span className="neu-sm flex h-9 w-9 items-center justify-center rounded-full text-accent">
                <Archive size={16} />
              </span>
              <span className="flex-1 text-left font-semibold">Archived</span>
              <span className="text-xs text-muted">{archivedCount}</span>
            </button>
          )
        )}

        {convStatus === 'loading' && <ConversationSkeleton />}
        {convStatus === 'error' && (
          <div className="p-6 text-center text-sm text-muted">
            <p>Could not load chats.</p>
            <button type="button" className="btn-ghost mt-3" onClick={() => useChat.getState().loadConversations().catch(() => {})}>
              Retry
            </button>
          </div>
        )}

        {list.map((c) => (
          <ConversationItem key={c._id} conversation={c} meId={meId} />
        ))}

        {convStatus === 'ready' && list.length === 0 && !q && (
          <EmptyState
            icon={MessageSquarePlus}
            title={showArchived ? 'No archived chats' : filter === 'all' ? 'No conversations yet' : 'Nothing here'}
            description={showArchived || filter !== 'all' ? undefined : 'Search for people above or start a new chat.'}
            action={!showArchived && filter === 'all' ? <button type="button" className="btn-primary" onClick={onNewChat}>Start a chat</button> : null}
          />
        )}

        {q && newPeople.length > 0 && (
          <div className="pt-3">
            <div className="label px-3">People</div>
            {newPeople.map((u) => (
              <button key={u._id} type="button" onClick={() => startChat(u)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-accent-soft/40">
                <UserAvatar src={u.avatar} name={u.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{u.name}</div>
                  <div className="truncate text-xs text-muted">@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {q && list.length === 0 && newPeople.length === 0 && <p className="py-8 text-center text-sm text-muted">No chats or people match “{q}”</p>}
      </div>
    </div>
  );
}
