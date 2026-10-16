import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, getErrorMessage } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { formatListTime } from '../lib/utils';
import { useUI } from '../store/uiStore';
import { Spinner } from './LoadingSkeleton';

function Highlight({ text, query }) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  const start = Math.max(0, i - 40);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark className="rounded bg-accent-soft px-0.5 text-accent">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length, i + query.length + 80)}
    </>
  );
}

/** Server-side search within one conversation; clicking a result scrolls to it. */
export default function ConversationSearch({ conversationId, onPick }) {
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 350);
  const [results, setResults] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  useEffect(() => {
    if (!q) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: null });
    api
      .get(`/messages/${conversationId}`, { params: { search: q, limit: 50 } })
      .then(({ data }) => !cancelled && setResults([...data.messages].reverse()))
      .catch((err) => !cancelled && setState({ loading: false, error: getErrorMessage(err) }))
      .finally(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [q, conversationId]);

  return (
    <div className="space-y-3">
      <label className="neu-inset flex items-center gap-2 rounded-2xl px-4 py-2.5">
        <Search size={16} className="text-muted" />
        <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="Search in this chat" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {state.loading && <Spinner className="h-4 w-4 text-accent" />}
      </label>
      {state.error && <p className="text-sm text-accent">{state.error}</p>}
      <div className="space-y-1">
        {results.map((m) => (
          <button
            key={m._id}
            type="button"
            className="w-full rounded-2xl px-3 py-2 text-left transition hover:bg-accent-soft"
            onClick={() => {
              useUI.getState().requestJump(conversationId, m._id);
              onPick?.();
            }}
          >
            <div className="flex justify-between gap-2 text-xs text-muted">
              <span className="font-semibold text-fg">{m.senderId?.name || 'Deleted account'}</span>
              <span>{formatListTime(m.createdAt)}</span>
            </div>
            <div className="line-clamp-2 text-sm">
              <Highlight text={m.text} query={q} />
            </div>
          </button>
        ))}
        {q && !state.loading && !state.error && results.length === 0 && <p className="py-6 text-center text-sm text-muted">No messages match “{q}”</p>}
      </div>
    </div>
  );
}
