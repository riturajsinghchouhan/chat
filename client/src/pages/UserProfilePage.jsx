import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, CalendarDays, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { formatLastSeen } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useAuth } from '../store/authStore';
import UserAvatar from '../components/UserAvatar';
import { usePresence } from '../components/ChatHeader';
import { FullPageLoader } from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import PageShell from './PageShell';

export default function UserProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const presence = usePresence(data?.user);

  useEffect(() => {
    if (userId === me._id) {
      navigate('/settings/profile', { replace: true });
      return;
    }
    setData(null);
    setError(null);
    api
      .get(`/users/${userId}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(getErrorMessage(err, 'User not found')));
  }, [userId, me._id, navigate]);

  const message = async () => {
    try {
      const conv = await useChat.getState().startDirect(userId);
      navigate(`/c/${conv._id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const toggleBlock = async () => {
    try {
      if (data.isBlocked) await api.delete(`/users/${userId}/block`);
      else await api.post(`/users/${userId}/block`);
      const list = (me.blockedUsers || []).map(String).filter((id) => id !== userId);
      useAuth.getState().patchUser({ blockedUsers: data.isBlocked ? list : [...list, userId] });
      setData({ ...data, isBlocked: !data.isBlocked });
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  if (error) return <EmptyState title="Profile unavailable" description={error} />;
  if (!data) return <FullPageLoader />;
  const { user } = data;

  return (
    <PageShell title={user.name} back="/">
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <UserAvatar src={user.avatar} name={user.name} size="xl" online={!data.blockedMe ? presence.isOnline : undefined} />
        <div>
          <h2 className="text-2xl font-extrabold">{user.name}</h2>
          <p className="text-muted">@{user.username}</p>
          {!data.blockedMe && <p className="mt-1 text-xs text-muted">{presence.isOnline ? 'online' : formatLastSeen(presence.lastSeen)}</p>}
        </div>
        <p className="max-w-sm text-sm whitespace-pre-wrap">{user.bio || 'Hey there! I am using Pulse.'}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarDays size={13} /> Joined {new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {!data.isBlocked && !data.blockedMe && (
            <button type="button" className="btn-primary" onClick={message}>
              <MessageCircle size={16} /> Message
            </button>
          )}
          <button type="button" className="btn-ghost text-accent" onClick={toggleBlock}>
            <Ban size={16} /> {data.isBlocked ? 'Unblock' : 'Block'}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
