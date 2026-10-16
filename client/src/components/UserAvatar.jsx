import { Users } from 'lucide-react';
import { publicUrl } from '../lib/api';
import { cn, initials } from '../lib/utils';
import OnlineIndicator from './OnlineIndicator';

const SIZES = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-28 w-28 text-3xl',
};
const PALETTE = ['#e5484d', '#3e8ef7', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e54d9e', '#6e56cf'];

function colorFor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function UserAvatar({ src, name = '', size = 'md', online, group = false, ring = true, className }) {
  const url = publicUrl(src);
  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-full font-bold text-white select-none',
          ring && 'neu-sm p-[3px]',
          SIZES[size],
        )}
      >
        {url ? (
          <img src={url} alt={name} loading="lazy" className="h-full w-full rounded-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full" style={{ background: colorFor(name) }}>
            {group ? <Users className="h-1/2 w-1/2" /> : initials(name)}
          </span>
        )}
      </div>
      {online !== undefined && <OnlineIndicator online={online} className="absolute right-0 bottom-0" size={size} />}
    </div>
  );
}
