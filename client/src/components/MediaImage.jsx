import { ImageOff } from 'lucide-react';
import { useInView } from '../hooks/useInView';
import { useMediaUrl } from '../hooks/useMediaUrl';
import { cn } from '../lib/utils';

/** Lazily loads an (optionally private) image once it scrolls near the viewport. */
export default function MediaImage({ src, fallbackSrc, alt = '', width, height, className, imgClassName, onClick, style }) {
  const [ref, inView] = useInView();
  const { src: resolved, error } = useMediaUrl(src, { enabled: inView && !fallbackSrc });
  const shown = fallbackSrc || resolved;
  const ratio = width && height ? `${width} / ${height}` : undefined;

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden bg-sunken', className)}
      style={{ aspectRatio: ratio, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick(e)}
    >
      {shown ? (
        <img src={shown} alt={alt} loading="lazy" decoding="async" className={cn('h-full w-full object-cover', imgClassName)} />
      ) : error ? (
        <div className="flex h-full min-h-24 w-full items-center justify-center text-muted">
          <ImageOff size={22} />
        </div>
      ) : (
        <div className="skeleton h-full min-h-24 w-full" />
      )}
    </div>
  );
}
