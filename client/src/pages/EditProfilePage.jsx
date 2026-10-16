import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { useAuth } from '../store/authStore';
import UserAvatar from '../components/UserAvatar';
import { Field } from './AuthLayout';
import PageShell from './PageShell';

export default function EditProfilePage() {
  const me = useAuth((s) => s.user);
  const [form, setForm] = useState({ name: me.name, username: me.username, bio: me.bio || '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const save = async (e) => {
    e.preventDefault();
    const patch = {};
    for (const k of ['name', 'username', 'bio']) if (form[k].trim() !== (me[k] || '')) patch[k] = form[k].trim();
    if (!Object.keys(patch).length) return toast('Nothing changed');
    setBusy(true);
    try {
      const { data } = await api.patch('/users/profile', patch);
      useAuth.getState().setUser(data.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return toast.error('Choose a JPEG, PNG, WebP or GIF image');
    if (file.size > 5 * 1024 * 1024) return toast.error('Avatar must be 5 MB or smaller');
    const body = new FormData();
    body.append('avatar', file);
    setUploading(true);
    try {
      const { data } = await api.post('/users/avatar', body);
      useAuth.getState().setUser(data.user);
      toast.success('Photo updated');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
    return undefined;
  };

  const removeAvatar = async () => {
    try {
      const { data } = await api.delete('/users/avatar');
      useAuth.getState().setUser(data.user);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <PageShell title="Edit profile" back="/settings">
      <div className="card space-y-6 p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <UserAvatar src={me.avatar} name={me.name} size="xl" />
            <button
              type="button"
              className="neu-accent absolute right-0 bottom-0 flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-60"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change photo"
            >
              <Camera size={18} />
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { uploadAvatar(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {uploading && <span className="text-xs text-muted">Uploading…</span>}
          {me.avatar && !uploading && (
            <button type="button" className="flex items-center gap-1 text-xs font-semibold text-accent" onClick={removeAvatar}>
              <Trash2 size={13} /> Remove photo
            </button>
          )}
        </div>
        <form onSubmit={save} className="space-y-4">
          <Field label="Name" id="name">
            <input id="name" className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Username" id="username">
            <input id="username" className="input" value={form.username} maxLength={30} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })} required />
          </Field>
          <Field label="Email" id="email">
            <input id="email" className="input opacity-70" value={me.email} disabled />
          </Field>
          <Field label="Bio" id="bio">
            <textarea id="bio" className="input min-h-24 resize-none" value={form.bio} maxLength={200} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Tell people a little about yourself" />
            <div className="mt-1 text-right text-xs text-muted">{form.bio.length}/200</div>
          </Field>
          <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </PageShell>
  );
}
