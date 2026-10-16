import { useEffect, useState } from 'react';
import { ShieldOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { useAuth } from '../store/authStore';
import UserAvatar from '../components/UserAvatar';
import EmptyState from '../components/EmptyState';
import { ConversationSkeleton } from '../components/LoadingSkeleton';
import PageShell from './PageShell';

export default function BlockedUsersPage() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/users/blocked')
      .then(({ data }) => setUsers(data.users))
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  const unblock = async (user) => {
    try {
      await api.delete(`/users/${user._id}/block`);
      setUsers((list) => list.filter((u) => u._id !== user._id));
      const me = useAuth.getState().user;
      useAuth.getState().patchUser({ blockedUsers: (me.blockedUsers || []).map(String).filter((id) => id !== user._id) });
      toast.success(`${user.name} unblocked`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <PageShell title="Blocked users" back="/settings">
      {error && <p className="text-sm text-accent">{error}</p>}
      {!users && !error && <ConversationSkeleton rows={3} />}
      {users?.length === 0 && <EmptyState icon={ShieldOff} title="No blocked users" description="People you block can't message you or start new chats with you." />}
      {users?.length > 0 && (
        <div className="card divide-y divide-[var(--line)] overflow-hidden">
          {users.map((u) => (
            <div key={u._id} className="flex items-center gap-3 px-5 py-3">
              <UserAvatar src={u.avatar} name={u.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{u.name}</div>
                <div className="truncate text-xs text-muted">@{u.username}</div>
              </div>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => unblock(u)}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
