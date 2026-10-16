import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { cn, conversationDisplay, formatListTime, idOf } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import Modal from './Modal';
import UserAvatar from './UserAvatar';
import { Spinner } from './LoadingSkeleton';

/** "New chat" and global message search in one place. */
export default function SearchModal({ open, onClose, initialTab = 'people', onNewGroup, meId }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 300);
  const [results, setResults] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });
  const conversations = useChat((s) => s.conversations);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setQuery('');
      setResults([]);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || !q) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: null });
    const req = tab === 'people' ? api.get('/users/search', { params: { q } }) : api.get('/messages/search', { params: { q } });
    req
      .then(({ data }) => !cancelled && setResults(tab === 'people' ? data.users : data.messages))
      .catch((err) => !cancelled && setState({ loading: false, error: getErrorMessage(err) }))
      .finally(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [q, tab, open]);

  const startChat = async (user) => {
    try {
      const conv = await useChat.getState().startDirect(user._id);
      onClose();
      navigate(`/c/${conv._id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const openMessage = (m) => {
    const convId = idOf(m.conversationId);
    onClose();
    navigate(`/c/${convId}`);
    setTimeout(() => useUI.getState().requestJump(convId, m._id), 150);
  };

  return (
    <Modal open={open} onClose={onClose} title={tab === 'people' ? 'New chat' : 'Search messages'}>
      <div className="space-y-4 px-5 pb-5">
        <div className="neu-inset grid grid-cols-2 gap-1 rounded-2xl p-1">
          {[
            ['people', 'People'],
            ['messages', 'Messages'],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => { setTab(key); setResults([]); }} className={cn('rounded-xl py-2 text-sm font-semibold', tab === key ? 'neu-sm text-accent' : 'text-muted')}>
              {label}
            </button>
          ))}
        </div>
        <label className="neu-inset flex items-center gap-2 rounded-2xl px-4 py-3">
          <Search size={16} className="text-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder={tab === 'people' ? 'Search by name or @username' : 'Search all your messages'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {state.loading && <Spinner className="h-4 w-4 text-accent" />}
        </label>

        {tab === 'people' && !q && (
          <button type="button" className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-accent-soft" onClick={() => { onClose(); onNewGroup(); }}>
            <span className="neu-accent flex h-10 w-10 items-center justify-center rounded-full">
              <Users size={18} />
            </span>
            <span className="font-semibold">New group</span>
          </button>
        )}

        {state.error && <p className="text-sm text-accent">{state.error}</p>}
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {tab === 'people' &&
            results.map((u) => (
              <button key={u._id} type="button" onClick={() => startChat(u)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-accent-soft">
                <UserAvatar src={u.avatar} name={u.name} size="sm" online={u.isOnline} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{u.name}</div>
                  <div className="truncate text-xs text-muted">@{u.username}{u.bio ? ` · ${u.bio}` : ''}</div>
                </div>
              </button>
            ))}
          {tab === 'messages' &&
            results.map((m) => {
              const conv = conversations[idOf(m.conversationId)];
              const name = conv ? conversationDisplay(conv, meId).name : 'Chat';
              return (
                <button key={m._id} type="button" onClick={() => openMessage(m)} className="w-full rounded-2xl px-3 py-2.5 text-left hover:bg-accent-soft">
                  <div className="flex justify-between gap-2 text-xs text-muted">
                    <span className="truncate font-semibold text-fg">
                      {name} · {m.senderId?.name || 'Deleted account'}
                    </span>
                    <span className="shrink-0">{formatListTime(m.createdAt)}</span>
                  </div>
                  <div className="line-clamp-2 text-sm">{m.text}</div>
                </button>
              );
            })}
          {q && !state.loading && !state.error && results.length === 0 && <p className="py-6 text-center text-sm text-muted">No results for “{q}”</p>}
        </div>
      </div>
    </Modal>
  );
}
