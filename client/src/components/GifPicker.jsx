import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, getErrorMessage } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { Spinner } from './LoadingSkeleton';

const RECENT_KEY = 'pulse-recent-gifs';

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 12);
  } catch {
    return [];
  }
}

function saveRecent(gif) {
  try {
    const next = [gif, ...readRecent().filter((g) => g.providerId !== gif.providerId)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function GifPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 400);
  const [gifs, setGifs] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, hasMore: false, nextOffset: 0 });
  const [recent] = useState(readRecent);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset = 0) => {
      const id = ++requestId.current;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data } = q
          ? await api.get('/gifs/search', { params: { q, offset } })
          : await api.get('/gifs/trending', { params: { offset } });
        if (id !== requestId.current) return;
        setGifs((prev) => (offset ? [...prev, ...data.gifs] : data.gifs));
        setState({ loading: false, error: null, hasMore: data.hasMore, nextOffset: data.nextOffset });
      } catch (err) {
        if (id !== requestId.current) return;
        setState({ loading: false, error: getErrorMessage(err, 'Could not load GIFs'), hasMore: false, nextOffset: 0 });
      }
    },
    [q],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const pick = (gif) => {
    saveRecent(gif);
    onSelect(gif);
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    if (state.hasMore && !state.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 120) load(state.nextOffset);
  };

  return (
    <div className="neu flex h-[min(420px,calc(100dvh-200px))] w-[min(360px,calc(100vw-16px))] flex-col overflow-hidden rounded-3xl bg-raised">
      <div className="flex items-center gap-2 p-3">
        <label className="neu-inset flex flex-1 items-center gap-2 rounded-2xl px-3 py-2">
          <Search size={16} className="text-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Search GIPHY"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            aria-label="Search GIFs"
          />
        </label>
        <button type="button" className="icon-btn h-9 w-9" onClick={onClose} aria-label="Close GIF picker">
          <X size={18} />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3" onScroll={onScroll}>
        {!q && recent.length > 0 && (
          <>
            <div className="label mt-1">Recent</div>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {recent.map((g) => (
                <button key={g.providerId} type="button" className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sunken" onClick={() => pick(g)}>
                  <img src={g.previewUrl || g.url} alt={g.title} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
        <div className="label">{q ? `Results for “${q}”` : 'Trending'}</div>

        {state.error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted">
            <p>{state.error}</p>
            <button type="button" className="btn-ghost" onClick={() => load(0)}>
              Retry
            </button>
          </div>
        ) : (
          <div className="columns-2 gap-2">
            {gifs.map((g) => (
              <button
                key={g.providerId}
                type="button"
                className="mb-2 block w-full overflow-hidden rounded-xl bg-sunken transition hover:ring-2 hover:ring-accent"
                style={{ aspectRatio: g.width && g.height ? `${g.width}/${g.height}` : undefined }}
                onClick={() => pick(g)}
                title={g.title}
              >
                <img src={g.previewUrl || g.url} alt={g.title} loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {state.loading && (
          <div className="flex justify-center py-4 text-accent">
            <Spinner />
          </div>
        )}
        {!state.loading && !state.error && gifs.length === 0 && <p className="py-10 text-center text-sm text-muted">No GIFs found</p>}
      </div>
      <div className="flex items-center justify-end px-3 py-2 text-[10px] font-bold tracking-widest text-muted uppercase">Powered by GIPHY</div>
    </div>
  );
}
