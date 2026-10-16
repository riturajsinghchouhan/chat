import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, Bell, ChevronRight, KeyRound, LogOut, Monitor, Moon, Palette, Sun, Trash2, UserRound, Volume2, Eye, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage, setAccessToken } from '../lib/api';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify';
import { useAuth } from '../store/authStore';
import { useUI } from '../store/uiStore';
import { cn } from '../lib/utils';
import UserAvatar from '../components/UserAvatar';
import Modal from '../components/Modal';
import WallpaperModal from '../components/WallpaperModal';
import { Field, passwordProblem } from './AuthLayout';
import PageShell from './PageShell';

function Toggle({ icon: Icon, title, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 px-5 py-4">
      <Icon size={20} className="shrink-0 text-accent" />
      <span className="flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
      <span className={cn('relative h-7 w-12 rounded-full transition', checked ? 'bg-accent' : 'neu-inset')}>
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
      </span>
    </label>
  );
}

function RowLink({ to, icon: Icon, title, onClick, danger }) {
  const content = (
    <>
      <Icon size={20} className={cn('shrink-0', danger ? 'text-accent' : 'text-accent')} />
      <span className={cn('flex-1 text-sm font-semibold', danger && 'text-accent')}>{title}</span>
      {!onClick && <ChevronRight size={18} className="text-muted" />}
    </>
  );
  const cls = 'flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-accent-soft/40';
  return to ? (
    <Link to={to} className={cls}>
      {content}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {content}
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const [pwOpen, setPwOpen] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const settings = me.settings || {};

  const updateSetting = async (key, value) => {
    useAuth.getState().patchUser({ settings: { ...settings, [key]: value } });
    try {
      const { data } = await api.patch('/users/settings', { [key]: value });
      useAuth.getState().setUser(data.user);
      if (key === 'notifications' && value && notificationsSupported() && Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    } catch (err) {
      useAuth.getState().patchUser({ settings });
      toast.error(getErrorMessage(err));
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/auth/change-password', pw);
      setAccessToken(data.accessToken);
      toast.success('Password changed. Other devices were signed out.');
      setPwOpen(false);
      setPw({ currentPassword: '', newPassword: '' });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    const password = await useUI.getState().confirm({
      title: 'Delete your account?',
      message: 'This permanently deletes your profile and removes you from groups. Messages you sent stay visible to recipients as "Deleted account". Enter your password to confirm.',
      input: { type: 'password', placeholder: 'Password' },
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!password) return;
    try {
      await api.delete('/users/me', { data: { password } });
      useAuth.getState().clearSession();
      toast.success('Your account was deleted');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const pwProblem = pw.newPassword ? passwordProblem(pw.newPassword) : null;
  const permission = notificationsSupported() ? Notification.permission : 'unsupported';

  return (
    <PageShell title="Settings">
      <div className="space-y-6">
        <Link to="/settings/profile" className="card flex items-center gap-4 p-5 transition hover:scale-[1.01]">
          <UserAvatar src={me.avatar} name={me.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{me.name}</div>
            <div className="truncate text-sm text-muted">@{me.username}</div>
            <div className="truncate text-xs text-muted">{me.bio}</div>
          </div>
          <ChevronRight className="text-muted" />
        </Link>

        <section>
          <h2 className="label px-1">Appearance</h2>
          <div className="card grid grid-cols-3 gap-2 p-2">
            {[
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Monitor],
            ].map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setTheme(key)} className={cn('flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-semibold transition', theme === key ? 'neu-inset text-accent' : 'text-muted hover:text-fg')}>
                <Icon size={20} /> {label}
              </button>
            ))}
          </div>
          <div className="card mt-3 overflow-hidden">
            <RowLink icon={Palette} title="Chat wallpaper" onClick={() => setWallpaperOpen(true)} />
          </div>
        </section>

        <section>
          <h2 className="label px-1">Notifications</h2>
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            <Toggle
              icon={Bell}
              title="Desktop notifications"
              description={permission === 'denied' ? 'Blocked in your browser settings' : permission === 'unsupported' ? 'Not supported in this browser' : 'Alerts while Pulse is in the background'}
              checked={settings.notifications !== false}
              onChange={(v) => updateSetting('notifications', v)}
            />
            <Toggle icon={Volume2} title="Message sounds" checked={settings.sound !== false} onChange={(v) => updateSetting('sound', v)} />
            <Toggle icon={Eye} title="Show message preview" description="Include message text in notifications" checked={settings.messagePreview !== false} onChange={(v) => updateSetting('messagePreview', v)} />
          </div>
        </section>

        <section>
          <h2 className="label px-1">Account & privacy</h2>
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            <RowLink to="/settings/profile" icon={UserRound} title="Edit profile" />
            <RowLink to="/settings/blocked" icon={Ban} title={`Blocked users${me.blockedUsers?.length ? ` (${me.blockedUsers.length})` : ''}`} />
            <RowLink icon={KeyRound} title="Change password" onClick={() => setPwOpen(true)} />
            <RowLink icon={LogOut} title="Log out" onClick={() => useAuth.getState().logout()} />
            <RowLink icon={Trash2} title="Delete account" onClick={deleteAccount} danger />
          </div>
        </section>

        <p className="flex items-start gap-2 px-1 text-xs text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Messages are protected in transit with HTTPS/WSS and stored on our server. Pulse does not use end-to-end encryption.
        </p>
      </div>

      <WallpaperModal open={wallpaperOpen} onClose={() => setWallpaperOpen(false)} />

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <form onSubmit={changePassword} className="space-y-4 px-5 pb-5">
          <Field label="Current password" id="cur">
            <input id="cur" type="password" className="input" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required autoFocus />
          </Field>
          <Field label="New password" id="new" error={pwProblem}>
            <input id="new" type="password" className="input" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={busy || !pw.currentPassword || !pw.newPassword || Boolean(pwProblem)}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </Modal>
    </PageShell>
  );
}
