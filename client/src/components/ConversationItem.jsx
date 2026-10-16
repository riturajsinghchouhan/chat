import { memo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Archive, BellOff, Check, CheckCheck, MoreHorizontal, Pin, PinOff, Bell, MailOpen } from 'lucide-react';
import { cn, conversationDisplay, formatListTime, idOf, messagePreview } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useClickOutside } from '../hooks/useClickOutside';
import UserAvatar from './UserAvatar';
import { usePresence } from './ChatHeader';

function ConversationItem({ conversation, meId }) {
  const display = conversationDisplay(conversation, meId);
  const presence = usePresence(display.user);
  const typingMap = useChat((s) => s.typing[conversation._id]);
  const typing = Object.keys(typingMap || {}).filter((id) => id !== meId);
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);

  // Touch: long-press opens the chat menu (pin / mute / archive) instead of opening the chat.
  const touchHandlers = {
    onTouchStart: () => {
      longPressed.current = false;
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        setMenu(true);
        navigator.vibrate?.(15);
      }, 450);
    },
    onTouchEnd: () => clearTimeout(pressTimer.current),
    onTouchMove: () => clearTimeout(pressTimer.current),
    onContextMenu: (e) => {
      e.preventDefault();
      setMenu(true);
    },
  };
  useClickOutside(ref, () => setMenu(false), menu);

  const unread = conversation.me?.unreadCount || 0;
  const last = conversation.lastMessage;
  const mineLast = last && last.type !== 'system' && idOf(last.senderId) === meId && !last.deletedAt;
  const prefs = (p) => useChat.getState().updatePrefs(conversation._id, p);

  let preview = messagePreview(last, meId) || (conversation.type === 'group' ? 'Group created' : 'Start the conversation');
  if (typing.length) {
    preview = conversation.type === 'group'
      ? `${conversation.members.find((m) => idOf(m.user) === typing[0])?.user?.name?.split(' ')[0] || 'Someone'} is typing…`
      : 'typing…';
  }

  return (
    <div className="touch-menu group relative" ref={ref} {...touchHandlers}>
      <NavLink
        to={`/c/${conversation._id}`}
        onClick={(e) => {
          if (longPressed.current) {
            e.preventDefault();
            longPressed.current = false;
          }
        }}
        className={({ isActive }) =>
          cn('flex items-center gap-3 rounded-2xl px-3 py-3 transition', isActive ? 'neu-inset' : 'hover:bg-accent-soft/40')
        }
      >
        <UserAvatar src={display.avatar} name={display.name} group={conversation.type === 'group'} online={display.user ? presence.isOnline : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-bold">{display.name}</span>
            <span className={cn('shrink-0 text-xs', unread ? 'font-semibold text-accent' : 'text-muted')}>{formatListTime(conversation.lastMessageAt)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn('flex min-w-0 items-center gap-1 truncate text-[13px]', typing.length ? 'text-accent' : 'text-muted')}>
              {mineLast && !typing.length && (last.status === 'read' ? <CheckCheck size={14} className="shrink-0 text-accent" /> : last.status === 'delivered' ? <CheckCheck size={14} className="shrink-0" /> : last.status === 'sent' ? <Check size={14} className="shrink-0" /> : null)}
              <span className="truncate">{preview}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-muted">
              {conversation.me?.muted && <BellOff size={13} aria-label="Muted" />}
              {conversation.me?.pinned && <Pin size={13} aria-label="Pinned" />}
              {unread > 0 && (
                <span className={cn('min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold', conversation.me?.muted ? 'bg-muted text-white' : 'neu-accent')}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
          </div>
        </div>
      </NavLink>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label="Chat options"
        className="icon-btn absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:hidden"
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="menu animate-pop absolute top-full right-2 z-40 -mt-2 w-48">
          <button type="button" className="menu-item" onClick={() => { setMenu(false); prefs({ pinned: !conversation.me?.pinned }); }}>
            {conversation.me?.pinned ? <PinOff size={16} /> : <Pin size={16} />} {conversation.me?.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" className="menu-item" onClick={() => { setMenu(false); prefs({ muted: !conversation.me?.muted }); }}>
            {conversation.me?.muted ? <Bell size={16} /> : <BellOff size={16} />} {conversation.me?.muted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" className="menu-item" onClick={() => { setMenu(false); prefs({ archived: !conversation.me?.archived }); }}>
            <Archive size={16} /> {conversation.me?.archived ? 'Unarchive' : 'Archive'}
          </button>
          {unread > 0 && (
            <button type="button" className="menu-item" onClick={() => { setMenu(false); useChat.getState().markRead(conversation._id); }}>
              <MailOpen size={16} /> Mark as read
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ConversationItem);
