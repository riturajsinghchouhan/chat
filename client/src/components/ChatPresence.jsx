import { useChat } from '../store/chatStore';
import { cn, idOf } from '../lib/utils';
import UserAvatar from './UserAvatar';

const NONE = {};

/** Other members who currently have this chat open (or are typing), in member order. */
export function useChatPresence(conversation, meId) {
  const viewers = useChat((s) => s.viewers[conversation._id] || NONE);
  const typing = useChat((s) => s.typing[conversation._id] || NONE);
  return conversation.members
    .map((m) => m.user)
    .filter((u) => u && typeof u === 'object' && u._id !== meId && (viewers[u._id] || typing[u._id]))
    .map((u) => ({ user: u, typing: Boolean(typing[u._id]) }));
}

/**
 * Snapchat-style presence: the avatar of everyone looking at the chat peeks up from the
 * bottom edge; it bobs and shows typing dots while they type.
 */
export default function ChatPresence({ people }) {
  if (!people.length) return null;
  const shown = people.slice(0, 5);
  const label = people
    .map(({ user, typing }) => `${user.name?.split(' ')[0] || 'Someone'} is ${typing ? 'typing' : 'here'}`)
    .join(', ');

  return (
    <div className="pointer-events-none absolute bottom-0 left-3 z-10 flex items-end sm:left-6" aria-live="polite" role="status">
      <div className="flex items-end -space-x-2 overflow-hidden">
        {shown.map(({ user, typing }) => (
          <div key={idOf(user)} className="peek-in relative h-10 w-12 shrink-0" title={`${user.name} is ${typing ? 'typing…' : 'in the chat'}`}>
            {/* Only the top part shows, as if peeking over the composer */}
            <div className={cn('absolute top-1 left-0', typing && 'peek-typing')}>
              <UserAvatar src={user.avatar} name={user.name || '?'} size="md" ring={false} className="drop-shadow-md" />
            </div>
          </div>
        ))}
      </div>
      {people.length > shown.length && <span className="neu-sm mb-1 ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted">+{people.length - shown.length}</span>}
      {people.some((p) => p.typing) && (
        <div className="neu-sm animate-pop mb-3 ml-1 flex items-center gap-1 rounded-full bg-panel px-3 py-2" aria-hidden="true">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
