import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, ImageOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { formatBytes, formatListTime } from '../lib/utils';
import { useUI } from '../store/uiStore';
import { downloadMedia } from '../hooks/useMediaUrl';
import MediaImage from './MediaImage';
import { Spinner } from './LoadingSkeleton';

/** Shared images/GIFs (grid) or files (list) for a conversation, paginated. */
export default function SharedMediaGrid({ conversationId, kind = 'media', columns = 3 }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, hasMore: false });

  const load = useCallback(
    async (before) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data } = await api.get(`/conversations/${conversationId}/media`, {
          params: { type: kind === 'files' ? 'file' : 'all', before, limit: 60 },
        });
        const list = kind === 'files' ? data.messages : data.messages.filter((m) => m.type !== 'file');
        setItems((prev) => (before ? [...prev, ...list] : list));
        setState({ loading: false, error: null, hasMore: data.hasMore, last: data.messages[data.messages.length - 1]?._id });
      } catch (err) {
        setState({ loading: false, error: getErrorMessage(err), hasMore: false });
      }
    },
    [conversationId, kind],
  );

  useEffect(() => {
    load();
  }, [load]);

  const images = items.filter((m) => m.type === 'image' || m.type === 'gif');
  const gallery = images.map((m) => ({ id: m._id, src: m.mediaUrl, caption: m.text, fileName: m.fileName }));

  if (state.error) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        <p>{state.error}</p>
        <button type="button" className="btn-ghost mt-3" onClick={() => load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {kind === 'files' ? (
        <div className="space-y-2">
          {items.map((m) => (
            <div key={m._id} className="neu-sm flex items-center gap-3 rounded-2xl p-3">
              <div className="neu-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <FileText size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{m.fileName}</div>
                <div className="text-xs text-muted">
                  {formatBytes(m.fileSize)} · {formatListTime(m.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn h-9 w-9"
                aria-label={`Download ${m.fileName}`}
                onClick={() => downloadMedia(m.mediaUrl, m.fileName).catch((err) => toast.error(getErrorMessage(err, 'Download failed')))}
              >
                <Download size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {images.map((m, i) => (
            <MediaImage
              key={m._id}
              src={m.type === 'gif' ? m.thumbnailUrl || m.mediaUrl : m.thumbnailUrl || m.mediaUrl}
              alt={m.text || 'Shared media'}
              className="aspect-square cursor-zoom-in rounded-xl"
              onClick={() => useUI.getState().openLightbox(gallery, i)}
            />
          ))}
        </div>
      )}
      {state.loading && (
        <div className="flex justify-center py-4 text-accent">
          <Spinner />
        </div>
      )}
      {!state.loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted">
          <ImageOff size={22} />
          {kind === 'files' ? 'No shared files yet' : 'No shared photos or GIFs yet'}
        </div>
      )}
      {state.hasMore && !state.loading && (
        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => load(state.last)}>
          Load more
        </button>
      )}
    </div>
  );
}
