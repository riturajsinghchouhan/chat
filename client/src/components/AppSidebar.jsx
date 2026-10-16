import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { MessageCircle, Plus, SearchCode, Settings, Users, WifiOff } from 'lucide-react';
import { useAuth } from '../store/authStore';
import { useChat } from '../store/chatStore';
import { cn } from '../lib/utils';
import UserAvatar from './UserAvatar';
import ConversationList from './ConversationList';
import NotificationPanel from './NotificationPanel';
import ThemeToggle from './ThemeToggle';
import SearchModal from './SearchModal';
import NewGroupModal from './NewGroupModal';

export default function AppSidebar() {
  const me = useAuth((s) => s.user);
  const connection = useChat((s) => s.connection);
  const [search, setSearch] = useState(null); // 'people' | 'messages' | null
  const [newGroup, setNewGroup] = useState(false);

  const navBtn = 'icon-btn neu-sm h-12 w-12';

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <Link to="/settings/profile" aria-label="Edit profile" className="shrink-0">
          <UserAvatar src={me.avatar} name={me.name} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">Chats</h1>
        </div>
        <NotificationPanel />
        <button type="button" className="neu-accent flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-accent-hover active:scale-95" onClick={() => setSearch('people')} aria-label="New chat" title="New chat">
          <Plus size={20} />
        </button>
      </div>

      {connection !== 'online' && (
        <div className={cn('mx-4 mb-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold', connection === 'offline' ? 'bg-accent-soft text-accent' : 'neu-inset text-muted')} role="status">
          <WifiOff size={14} /> {connection === 'offline' ? 'Offline — messages will send when you reconnect' : 'Connecting…'}
        </div>
      )}

      <ConversationList meId={me._id} onNewChat={() => setSearch('people')} />

      <nav className="mx-3 mb-3 flex items-center justify-around rounded-[28px] neu px-2 py-2.5 safe-bottom" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => cn(navBtn, isActive && 'text-accent')} aria-label="Chats" title="Chats">
          <MessageCircle size={20} />
        </NavLink>
        <button type="button" className={navBtn} onClick={() => setSearch('messages')} aria-label="Search messages" title="Search messages">
          <SearchCode size={20} />
        </button>
        <button type="button" className={navBtn} onClick={() => setNewGroup(true)} aria-label="New group" title="New group">
          <Users size={20} />
        </button>
        <ThemeToggle className="h-12 w-12" />
        <NavLink to="/settings" className={({ isActive }) => cn(navBtn, isActive && 'text-accent')} aria-label="Settings" title="Settings">
          <Settings size={20} />
        </NavLink>
      </nav>

      <SearchModal open={Boolean(search)} initialTab={search || 'people'} onClose={() => setSearch(null)} onNewGroup={() => setNewGroup(true)} meId={me._id} />
      <NewGroupModal open={newGroup} onClose={() => setNewGroup(false)} />
    </aside>
  );
}
