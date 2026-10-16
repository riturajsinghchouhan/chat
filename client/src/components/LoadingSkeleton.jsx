import { cn } from '../lib/utils';

export function ConversationSkeleton({ rows = 7 }) {
  return (
    <div className="space-y-1 px-3" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-3">
          <div className="skeleton h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/2 rounded-full" />
            <div className="skeleton h-2.5 w-3/4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageSkeleton() {
  const widths = ['w-1/3', 'w-1/2', 'w-2/5', 'w-1/4', 'w-3/5', 'w-1/3'];
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading messages">
      {widths.map((w, i) => (
        <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <div className={cn('skeleton h-10 rounded-2xl', w)} />
        </div>
      ))}
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="neu flex h-20 w-20 items-center justify-center rounded-3xl">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
      </div>
    </div>
  );
}

export function Spinner({ className }) {
  return <div className={cn('h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}
