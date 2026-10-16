import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArrowLeft, BellOff, Bell, Ban, Images, Info, LogOut, MoreVertical, Pin, PinOff, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { conversationDisplay, formatLastSeen, idOf } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import { useAuth } from '../store/authStore';
import { useClickOutside } from '../hooks/useClickOutside';
import UserAvatar from './UserAvatar';

export function usePresence(user) {
  const live = useChat((s) => (user?._id ? s.presence[user._id] : null));
  if (!user) return { isOnline: false, lastSeen: null };
  return live || { isOnline: user.isOnline, lastSeen: user.lastSeen };
}

export default function ChatHeader({ conversation, onOpenInfo, onOpenSearch }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const typingMap = useChat((s) => s.typing[conversation._id]);
  const display = conversationDisplay(conversation, me._id);
  const presence = usePresence(display.user);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const close = useCallback(() => setMenu(false), []);
  useClickOutside(menuRef, close, menu);

  const isGroup = conversation.type === 'group';
  const blocked = display.user && (me.blockedUsers || []).map(String).includes(display.user._id);
  const typers = Object.keys(typingMap || {}).filter((id) => id !== me._id);

  let status;
  if (typers.length) {
    status = (
      <span className="text-accent">
        {isGroup
          ? `${typers.map((id) => conversation.members.find((m) => idOf(m.user) === id)?.user?.name?.split(' ')[0]).filter(Boolean).join(', ')} typing…`
          : 'typing…'}
      </span>
    );
  } else if (isGroup) {
    const names = conversation.members.map((m) => (idOf(m.user) === me._id ? 'You' : m.user?.name?.split(' ')[0])).filter(Boolean);
    status = `${conversation.members.length} members · ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}`;
  } else if (display.deleted) {
    status = 'Account deleted';
  } else if (blocked) {
    status = 'Blocked';
  } else {
    status = presence.isOnline ? <span className="text-success">online</span> : formatLastSeen(presence.lastSeen);
  }

  const prefs = (p) => useChat.getState().updatePrefs(conversation._id, p);

  const toggleBlock = async () => {
    const userId = display.user._id;
    try {
      if (blocked) await api.delete(`/users/${userId}/block`);
      else {
        const ok = await useUI.getState().confirm({
          title: `Block ${display.name}?`,
          message: 'You will not be able to message each other until you unblock them.',
          confirmLabel: 'Block',
          danger: true,
        });
        if (!ok) return;
        await api.post(`/users/${userId}/block`);
      }
      const list = (me.blockedUsers || []).map(String).filter((id) => id !== userId);
      useAuth.getState().patchUser({ blockedUsers: blocked ? list : [...list, userId] });
      toast.success(blocked ? 'Unblocked' : 'Blocked');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const leaveGroup = async () => {
    const ok = await useUI.getState().confirm({ title: `Leave "${conversation.name}"?`, confirmLabel: 'Leave', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/groups/${conversation._id}/members/${me._id}`);
      useChat.getState().removeConversation(conversation._id);
      navigate('/');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const item = (Icon, label, onClick, danger) => (
    <button
      type="button"
      className={`menu-item ${danger ? 'text-accent' : ''}`}
      onClick={() => {
        setMenu(false);
        onClick();
      }}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
      <Link to="/" className="icon-btn neu-sm md:hidden" aria-label="Back to chats">
        <ArrowLeft size={20} className="text-accent" />
      </Link>
      <button type="button" onClick={onOpenInfo} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <UserAvatar src={display.avatar} name={display.name} group={isGroup} online={!isGroup && !blocked ? presence.isOnline : undefined} />
        <div className="min-w-0">
          <div className="truncate font-bold">{display.name}</div>
          <div className="truncate text-xs text-muted">{status}</div>
        </div>
      </button>
      <button type="button" className="icon-btn neu-sm hidden sm:inline-flex" onClick={onOpenSearch} aria-label="Search in conversation" title="Search">
        <Search size={18} />
      </button>
      <button type="button" className="icon-btn neu-sm hidden sm:inline-flex" onClick={onOpenInfo} aria-label="Conversation info" title="Info">
        <Info size={18} />
      </button>
      <div className="relative" ref={menuRef}>
        <button type="button" className="icon-btn neu-sm" onClick={() => setMenu((m) => !m)} aria-label="More options" aria-expanded={menu}>
          <MoreVertical size={18} />
        </button>
        {menu && (
          <div className="menu animate-pop absolute top-full right-0 mt-2 w-56">
            {item(Search, 'Search messages', onOpenSearch)}
            {item(Info, isGroup ? 'Group info' : 'Contact info', onOpenInfo)}
            {item(Images, 'Shared media', () => navigate(`/c/${conversation._id}/media`))}
            {item(conversation.me?.muted ? Bell : BellOff, conversation.me?.muted ? 'Unmute' : 'Mute notifications', () => prefs({ muted: !conversation.me?.muted }))}
            {item(conversation.me?.pinned ? PinOff : Pin, conversation.me?.pinned ? 'Unpin chat' : 'Pin chat', () => prefs({ pinned: !conversation.me?.pinned }))}
            {item(Archive, conversation.me?.archived ? 'Unarchive' : 'Archive', () => prefs({ archived: !conversation.me?.archived }))}
            {!isGroup && display.user && item(Ban, blocked ? 'Unblock' : 'Block', toggleBlock, !blocked)}
            {isGroup && item(LogOut, 'Leave group', leaveGroup, true)}
          </div>
        )}
      </div>
    </header>
  );
}
