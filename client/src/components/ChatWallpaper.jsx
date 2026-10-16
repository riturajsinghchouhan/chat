import { useMediaUrl } from '../hooks/useMediaUrl';
import { presetById } from '../lib/wallpapers';
import { cn } from '../lib/utils';

/** Background layer behind a chat. Renders nothing without a wallpaper. */
export default function ChatWallpaper({ wallpaper, className }) {
  const isImage = wallpaper?.kind === 'image';
  const { src } = useMediaUrl(isImage ? wallpaper.url : null);
  if (!wallpaper) return null;

  let background = null;
  if (wallpaper.kind === 'preset') background = presetById(wallpaper.value)?.background;
  else if (wallpaper.kind === 'color') background = wallpaper.value;
  else if (isImage && src) background = `center / cover no-repeat url("${src}")`;

  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className={cn('absolute inset-0 transition-opacity duration-300', background ? 'opacity-100' : 'opacity-0')} style={{ background: background || undefined }} />
      {wallpaper.dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: wallpaper.dim / 100 }} />}
    </div>
  );
}
