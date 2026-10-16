import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { api, getErrorMessage } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { cn } from '../lib/utils';
import UserAvatar from './UserAvatar';
import { Spinner } from './LoadingSkeleton';

/** Debounced server-side user search with multi-select chips. */
export default function UserPicker({ selected, onChange, excludeIds = [] }) {
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 300);
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
      .get('/users/search', { params: { q } })
      .then(({ data }) => !cancelled && setResults(data.users))
      .catch((err) => !cancelled && setState({ loading: false, error: getErrorMessage(err) }))
      .finally(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const isSelected = (u) => selected.some((s) => s._id === u._id);
  const toggle = (u) => onChange(isSelected(u) ? selected.filter((s) => s._id !== u._id) : [...selected, u]);
  const visible = results.filter((u) => !excludeIds.includes(u._id));

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((u) => (
            <span key={u._id} className="neu-sm flex items-center gap-1.5 rounded-full py-1 pr-2 pl-1 text-xs font-semibold">
              <UserAvatar src={u.avatar} name={u.name} size="xs" ring={false} />
              {u.name}
              <button type="button" onClick={() => toggle(u)} aria-label={`Remove ${u.name}`} className="text-muted hover:text-accent">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="neu-inset flex items-center gap-2 rounded-2xl px-4 py-2.5">
        <Search size={16} className="text-muted" />
        <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="Search by name or username" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {state.loading && <Spinner className="h-4 w-4 text-accent" />}
      </label>
      {state.error && <p className="text-sm text-accent">{state.error}</p>}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {visible.map((u) => (
          <button key={u._id} type="button" onClick={() => toggle(u)} className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-accent-soft', isSelected(u) && 'bg-accent-soft')}>
            <UserAvatar src={u.avatar} name={u.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{u.name}</div>
              <div className="truncate text-xs text-muted">@{u.username}</div>
            </div>
            {isSelected(u) && <Check size={18} className="text-accent" />}
          </button>
        ))}
        {q && !state.loading && visible.length === 0 && !state.error && <p className="py-4 text-center text-sm text-muted">No users found</p>}
      </div>
    </div>
  );
}
