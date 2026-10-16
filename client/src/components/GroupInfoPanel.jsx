import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Crown, LogOut, MoreHorizontal, Pencil, Shield, UserMinus, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { idOf } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import { useClickOutside } from '../hooks/useClickOutside';
import UserAvatar from './UserAvatar';
import Modal from './Modal';
import UserPicker from './UserPicker';
import { usePresence } from './ChatHeader';

function MemberRow({ member, meId, isAdmin, groupId }) {
  const user = member.user;
  const presence = usePresence(user);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const navigate = useNavigate();
  const isMe = idOf(user) === meId;

  const setRole = async (role) => {
    try {
      const { data } = await api.patch(`/groups/${groupId}/members/${user._id}`, { role });
      useChat.getState().upsertConversation(data.conversation);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };
  const remove = async () => {
    const ok = await useUI.getState().confirm({ title: `Remove ${user.name}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/groups/${groupId}/members/${user._id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-accent-soft/50">
      <button type="button" onClick={() => !isMe && navigate(`/u/${user._id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <UserAvatar src={user.avatar} name={user.name} size="sm" online={presence.isOnline} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{isMe ? 'You' : user.name}</div>
          <div className="truncate text-xs text-muted">@{user.username}</div>
        </div>
      </button>
      {member.role === 'admin' && (
        <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent uppercase">
          <Crown size={11} /> Admin
        </span>
      )}
      {isAdmin && !isMe && (
        <div className="relative" ref={ref}>
          <button type="button" className="icon-btn h-8 w-8" onClick={() => setOpen((o) => !o)} aria-label={`Manage ${user.name}`}>
            <MoreHorizontal size={16} />
          </button>
          {open && (
            <div className="menu animate-pop absolute top-full right-0 mt-1 w-48">
              <button type="button" className="menu-item" onClick={() => { setOpen(false); setRole(member.role === 'admin' ? 'member' : 'admin'); }}>
                <Shield size={16} /> {member.role === 'admin' ? 'Dismiss as admin' : 'Make admin'}
              </button>
              <button type="button" className="menu-item text-accent" onClick={() => { setOpen(false); remove(); }}>
                <UserMinus size={16} /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GroupInfoPanel({ conversation, meId }) {
  const navigate = useNavigate();
  const isAdmin = conversation.me?.role === 'admin';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: conversation.name, description: conversation.description || '' });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const update = async (patch) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/groups/${conversation._id}`, patch);
      useChat.getState().upsertConversation(data.conversation);
      setEditing(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    const body = new FormData();
    body.append('avatar', file);
    const t = toast.loading('Uploading photo…');
    try {
      const { data } = await api.post(`/groups/${conversation._id}/avatar`, body);
      useChat.getState().upsertConversation(data.conversation);
      toast.success('Group photo updated', { id: t });
    } catch (err) {
      toast.error(getErrorMessage(err), { id: t });
    }
  };

  const addMembers = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/groups/${conversation._id}/members`, { userIds: selected.map((u) => u._id) });
      useChat.getState().upsertConversation(data.conversation);
      setAdding(false);
      setSelected([]);
      toast.success('Members added');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    const ok = await useUI.getState().confirm({ title: `Leave "${conversation.name}"?`, confirmLabel: 'Leave', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/groups/${conversation._id}/members/${meId}`);
      useChat.getState().removeConversation(conversation._id);
      navigate('/');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const members = [...conversation.members].sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1));

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative">
          <UserAvatar src={conversation.avatar} name={conversation.name} size="xl" group />
          {isAdmin && (
            <>
              <button type="button" className="neu-accent absolute right-0 bottom-0 flex h-9 w-9 items-center justify-center rounded-full" onClick={() => fileRef.current?.click()} aria-label="Change group photo">
                <Camera size={16} />
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { uploadAvatar(e.target.files?.[0]); e.target.value = ''; }} />
            </>
          )}
        </div>
        {editing ? (
          <form className="w-full space-y-3" onSubmit={(e) => { e.preventDefault(); update({ name: form.name.trim(), description: form.description.trim() }); }}>
            <input className="input" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required aria-label="Group name" />
            <textarea className="input min-h-20 resize-none" value={form.description} maxLength={300} placeholder="Group description" onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Group description" />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>Save</button>
            </div>
          </form>
        ) : (
          <div>
            <div className="flex items-center justify-center gap-2">
              <h3 className="text-xl font-bold">{conversation.name}</h3>
              {isAdmin && (
                <button type="button" className="icon-btn h-8 w-8" onClick={() => { setForm({ name: conversation.name, description: conversation.description || '' }); setEditing(true); }} aria-label="Edit group">
                  <Pencil size={15} />
                </button>
              )}
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{conversation.description || 'No description'}</p>
            <p className="mt-1 text-xs text-muted">Group · {conversation.members.length} members</p>
          </div>
        )}
      </div>

      {isAdmin && (
        <label className="neu-sm flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm">
          <span>
            <span className="block font-semibold">Only admins can send messages</span>
            <span className="text-xs text-muted">Members can still read and react</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={Boolean(conversation.settings?.adminsOnlyMessages)} disabled={busy} onChange={(e) => update({ adminsOnlyMessages: e.target.checked })} />
        </label>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">{conversation.members.length} members</span>
          {isAdmin && (
            <button type="button" className="flex items-center gap-1 text-xs font-semibold text-accent" onClick={() => setAdding(true)}>
              <UserPlus size={14} /> Add
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {members.map((m) => (
            <MemberRow key={idOf(m.user)} member={m} meId={meId} isAdmin={isAdmin} groupId={conversation._id} />
          ))}
        </div>
      </div>

      <button type="button" className="btn-ghost w-full text-accent" onClick={leave}>
        <LogOut size={16} /> Leave group
      </button>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add members">
        <div className="space-y-4 px-5 pb-5">
          <UserPicker selected={selected} onChange={setSelected} excludeIds={conversation.members.map((m) => idOf(m.user))} />
          <button type="button" className="btn-primary w-full" disabled={!selected.length || busy} onClick={addMembers}>
            Add {selected.length || ''} member{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
