import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, ImageOff, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { formatBytes, formatListTime } from '../lib/utils';
import { formatDuration } from '../lib/video';
import { useUI } from '../store/uiStore';
import { downloadMedia } from '../hooks/useMediaUrl';
import MediaImage from './MediaImage';
import Modal from './Modal';
import VideoMessage from './VideoMessage';
import { Spinner } from './LoadingSkeleton';

/** Shared images/GIFs (grid) or files (list) for a conversation, paginated. */
export default function SharedMediaGrid({ conversationId, kind = 'media', columns = 3 }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, hasMore: false });
  const [playing, setPlaying] = useState(null);

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

  const tiles = items.filter((m) => m.type === 'image' || m.type === 'gif' || m.type === 'video');
  const images = tiles.filter((m) => m.type !== 'video');
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
          {tiles.map((m) =>
            m.type === 'video' ? (
              <div key={m._id} className="relative">
                <MediaImage src={m.thumbnailUrl} alt={m.text || 'Shared video'} className="aspect-square cursor-pointer rounded-xl" onClick={() => setPlaying(m)} />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
                    <Play size={16} className="ml-0.5" fill="currentColor" />
                  </span>
                </span>
                {m.duration ? (
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{formatDuration(m.duration)}</span>
                ) : null}
              </div>
            ) : (
              <MediaImage
                key={m._id}
                src={m.thumbnailUrl || m.mediaUrl}
                alt={m.text || 'Shared media'}
                className="aspect-square cursor-zoom-in rounded-xl"
                onClick={() => useUI.getState().openLightbox(gallery, images.indexOf(m))}
              />
            ),
          )}
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
          {kind === 'files' ? 'No shared files yet' : 'No shared photos, videos or GIFs yet'}
        </div>
      )}
      {state.hasMore && !state.loading && (
        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => load(state.last)}>
          Load more
        </button>
      )}
      {playing && (
        <Modal open onClose={() => setPlaying(null)} title={playing.text || 'Video'}>
          <div className="flex justify-center px-5 pb-5">
            <VideoMessage message={playing} maxW={360} autoPlay />
          </div>
        </Modal>
      )}
    </div>
  );
}
