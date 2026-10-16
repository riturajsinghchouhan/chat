import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Bell, BellOff, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { cn, conversationDisplay, formatLastSeen } from '../lib/utils';
import { useAuth } from '../store/authStore';
import { useChat } from '../store/chatStore';
import UserAvatar from './UserAvatar';
import GroupInfoPanel from './GroupInfoPanel';
import SharedMediaGrid from './SharedMediaGrid';
import ConversationSearch from './ConversationSearch';
import { usePresence } from './ChatHeader';

const TABS = [
  ['info', 'Info'],
  ['media', 'Media'],
  ['files', 'Files'],
  ['search', 'Search'],
];

function DirectInfo({ conversation, me }) {
  const display = conversationDisplay(conversation, me._id);
  const user = display.user;
  const presence = usePresence(user);
  const blocked = user && (me.blockedUsers || []).map(String).includes(user._id);

  const toggleBlock = async () => {
    try {
      if (blocked) await api.delete(`/users/${user._id}/block`);
      else await api.post(`/users/${user._id}/block`);
      const list = (me.blockedUsers || []).map(String).filter((id) => id !== user._id);
      useAuth.getState().patchUser({ blockedUsers: blocked ? list : [...list, user._id] });
      toast.success(blocked ? 'Unblocked' : 'Blocked');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  if (!user) return <p className="py-8 text-center text-sm text-muted">This account has been deleted.</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <UserAvatar src={user.avatar} name={user.name} size="xl" online={!blocked ? presence.isOnline : undefined} />
        <div>
          <Link to={`/u/${user._id}`} className="text-xl font-bold hover:text-accent">
            {user.name}
          </Link>
          <p className="text-sm text-muted">@{user.username}</p>
          <p className="mt-1 text-xs text-muted">{presence.isOnline ? 'online' : formatLastSeen(presence.lastSeen)}</p>
        </div>
      </div>
      <div className="neu-inset rounded-2xl p-4">
        <div className="label">About</div>
        <p className="text-sm whitespace-pre-wrap">{user.bio || 'Hey there! I am using Pulse.'}</p>
      </div>
      <div className="space-y-2">
        <button type="button" className="btn-ghost w-full justify-start" onClick={() => useChat.getState().updatePrefs(conversation._id, { muted: !conversation.me?.muted })}>
          {conversation.me?.muted ? <Bell size={16} /> : <BellOff size={16} />}
          {conversation.me?.muted ? 'Unmute notifications' : 'Mute notifications'}
        </button>
        <button type="button" className="btn-ghost w-full justify-start text-accent" onClick={toggleBlock}>
          <Ban size={16} /> {blocked ? `Unblock ${user.name}` : `Block ${user.name}`}
        </button>
      </div>
    </div>
  );
}

export default function ConversationInfoPanel({ conversation, initialTab = 'info', onClose }) {
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState(initialTab);

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-panel">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-lg font-bold">{conversation.type === 'group' ? 'Group info' : 'Contact info'}</h2>
        <button type="button" className="icon-btn neu-sm h-9 w-9" onClick={onClose} aria-label="Close panel">
          <X size={18} />
        </button>
      </div>
      <div className="mx-5 mb-3 grid grid-cols-4 gap-1 rounded-2xl neu-inset p-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn('rounded-xl py-1.5 text-xs font-semibold transition', tab === key ? 'neu-sm text-accent' : 'text-muted hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {tab === 'info' &&
          (conversation.type === 'group' ? <GroupInfoPanel conversation={conversation} meId={me._id} /> : <DirectInfo conversation={conversation} me={me} />)}
        {tab === 'media' && <SharedMediaGrid conversationId={conversation._id} />}
        {tab === 'files' && <SharedMediaGrid conversationId={conversation._id} kind="files" />}
        {tab === 'search' && <ConversationSearch conversationId={conversation._id} />}
      </div>
    </aside>
  );
}
