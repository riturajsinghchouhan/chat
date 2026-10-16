import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useUI } from '../store/uiStore';
import { downloadMedia, useMediaUrl } from '../hooks/useMediaUrl';
import { getErrorMessage } from '../lib/api';

export default function ImagePreviewModal() {
  const lightbox = useUI((s) => s.lightbox);
  const close = useUI((s) => s.closeLightbox);
  const open = useUI((s) => s.openLightbox);
  const item = lightbox?.items[lightbox.index];
  const { src, error } = useMediaUrl(item?.src);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft' && lightbox.index > 0) open(lightbox.items, lightbox.index - 1);
      if (e.key === 'ArrowRight' && lightbox.index < lightbox.items.length - 1) open(lightbox.items, lightbox.index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, close, open]);

  if (!lightbox || !item) return null;

  const download = async () => {
    try {
      if (item.src.startsWith('/api/media/')) await downloadMedia(item.src, item.fileName || 'image');
      else window.open(item.src, '_blank', 'noopener');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Download failed'));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/90 text-white" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0 text-sm">
          <div className="truncate font-semibold">{item.caption || item.fileName || 'Image'}</div>
          {lightbox.items.length > 1 && (
            <div className="text-xs text-white/60">
              {lightbox.index + 1} / {lightbox.items.length}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="icon-btn text-white hover:text-white hover:bg-white/10" onClick={download} aria-label="Download">
            <Download size={20} />
          </button>
          <button type="button" className="icon-btn text-white hover:text-white hover:bg-white/10" onClick={close} aria-label="Close viewer">
            <X size={22} />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        {lightbox.index > 0 && (
          <button type="button" className="icon-btn absolute left-3 bg-white/10 text-white hover:text-white" onClick={() => open(lightbox.items, lightbox.index - 1)} aria-label="Previous">
            <ChevronLeft />
          </button>
        )}
        {src ? (
          <img src={src} alt={item.caption || ''} className="max-h-full max-w-full rounded-xl object-contain" />
        ) : error ? (
          <p className="text-white/70">Image could not be loaded</p>
        ) : (
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/70 border-t-transparent" />
        )}
        {lightbox.index < lightbox.items.length - 1 && (
          <button type="button" className="icon-btn absolute right-3 bg-white/10 text-white hover:text-white" onClick={() => open(lightbox.items, lightbox.index + 1)} aria-label="Next">
            <ChevronRight />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
