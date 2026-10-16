import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../store/authStore';
import { getErrorMessage } from '../lib/api';
import AuthLayout, { Field } from './AuthLayout';

export default function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.identifier.trim(), form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue your conversations."
      footer={
        <>
          New to Pulse?{' '}
          <Link to="/register" className="font-semibold text-accent">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email or username" id="identifier">
          <input id="identifier" className="input" autoComplete="username" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} required autoFocus />
        </Field>
        <Field label="Password" id="password">
          <div className="relative">
            <input
              id="password"
              className="input pr-12"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <button type="button" className="icon-btn absolute top-1/2 right-1 h-9 w-9 -translate-y-1/2" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </Field>
        <div className="text-right">
          <Link to="/forgot-password" className="text-xs font-semibold text-accent">
            Forgot password?
          </Link>
        </div>
        {error && (
          <p role="alert" className="rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-accent">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full py-3" disabled={busy || !form.identifier || !form.password}>
          {busy ? 'Signing in…' : 'Sign in'} <LogIn size={16} />
        </button>
      </form>
    </AuthLayout>
  );
}
