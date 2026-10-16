import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../store/authStore';
import { getErrorMessage } from '../lib/api';
import AuthLayout, { Field, passwordProblem } from './AuthLayout';

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '' });
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const errors = {
    name: !form.name.trim() ? 'Enter your name' : null,
    username: !USERNAME_RE.test(form.username) ? '3–30 chars: lowercase letters, numbers, "_" or "."' : null,
    email: !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid email' : null,
    password: passwordProblem(form.password),
  };
  const valid = !Object.values(errors).some(Boolean);
  const set = (key) => (e) => setForm({ ...form, [key]: key === 'username' ? e.target.value.toLowerCase().replace(/\s/g, '') : e.target.value });
  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, username: true, email: true, password: true });
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, name: form.name.trim(), email: form.email.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create account'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Real-time chat, groups, GIFs and photos."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-accent">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" id="name" error={touched.name && errors.name}>
          <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} onBlur={blur('name')} maxLength={60} autoFocus />
        </Field>
        <Field label="Username" id="username" error={touched.username && errors.username}>
          <input id="username" className="input" autoComplete="username" value={form.username} onChange={set('username')} onBlur={blur('username')} maxLength={30} />
        </Field>
        <Field label="Email" id="email" error={touched.email && errors.email}>
          <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} onBlur={blur('email')} />
        </Field>
        <Field label="Password" id="password" error={touched.password && errors.password}>
          <input id="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={set('password')} onBlur={blur('password')} />
        </Field>
        {error && (
          <p role="alert" className="rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-accent">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'} <UserPlus size={16} />
        </button>
      </form>
    </AuthLayout>
  );
}
