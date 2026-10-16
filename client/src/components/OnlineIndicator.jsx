import { cn } from '../lib/utils';

export default function OnlineIndicator({ online, size = 'md', className }) {
  if (!online) return null;
  const dim = size === 'lg' || size === 'xl' ? 'h-4 w-4' : size === 'xs' || size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  return <span title="Online" aria-label="Online" className={cn('rounded-full border-2 border-[var(--raised)] bg-success', dim, className)} />;
}
