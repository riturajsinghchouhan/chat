import { useEffect, useState } from 'react';
import { AlertCircle, Play } from 'lucide-react';
import { getStreamUrl } from '../hooks/useMediaUrl';
import { formatDuration } from '../lib/video';
import { cn } from '../lib/utils';
import MediaImage from './MediaImage';

/**
 * A short video clip. Shows the poster until tapped; then the browser streams the file
 * with Range requests (only the parts being played are downloaded, seeking works).
 */
export default function VideoMessage({ message, pending, maxW = 260, autoPlay = false, className }) {
  const [src, setSrc] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | playing | error
  const uploading = message.status === 'sending' && message.uploadProgress !== undefined && message.uploadProgress < 100;
  const portrait = message.width && message.height ? message.height > message.width : true;
  const width = portrait ? Math.min(maxW, 220) : maxW;
  const ratio = message.width && message.height ? `${message.width} / ${message.height}` : portrait ? '9 / 16' : '16 / 9';

  const play = async () => {
    if (pending && !message.localPreview) return;
    setState('loading');
    try {
      setSrc(message.localPreview || (await getStreamUrl(message.mediaUrl)));
      setState('playing');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    if (autoPlay) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-black', className)} style={{ width, maxWidth: '100%', aspectRatio: ratio }}>
      {src ? (
        <video
          src={src}
          poster={message.posterPreview || undefined}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="h-full w-full object-contain"
          onError={() => setState('error')}
        />
      ) : (
        <>
          <MediaImage
            src={message.thumbnailUrl}
            fallbackSrc={message.posterPreview}
            alt={message.text || 'Video'}
            className="absolute inset-0 h-full w-full"
          />
          <button
            type="button"
            onClick={play}
            disabled={uploading || state === 'loading'}
            aria-label="Play video"
            className="absolute inset-0 flex items-center justify-center bg-black/10 transition hover:bg-black/25"
          >
            {uploading ? (
              <span className="rounded-full bg-black/55 px-3 py-1.5 text-sm font-semibold text-white">{message.uploadProgress}%</span>
            ) : state === 'loading' ? (
              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/80 border-t-transparent" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <Play size={22} className="ml-0.5" fill="currentColor" />
              </span>
            )}
          </button>
          {message.duration ? (
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {formatDuration(message.duration)}
            </span>
          ) : null}
        </>
      )}
      {state === 'error' && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/70 px-3 py-1.5 text-xs text-white">
          <AlertCircle size={14} /> Could not play this video
        </div>
      )}
    </div>
  );
}
