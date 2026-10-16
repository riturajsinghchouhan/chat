import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import AuthLayout, { Field, passwordProblem } from './AuthLayout';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const problem = password ? passwordProblem(password) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (problem || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      toast.success(data.message);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!/^[a-f\d]{64}$/.test(token)) {
    return (
      <AuthLayout title="Invalid reset link" subtitle="This link is malformed or incomplete." footer={<Link to="/forgot-password" className="font-semibold text-accent">Request a new link</Link>}>
        <span />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out of all other devices." footer={<Link to="/login" className="font-semibold text-accent">Back to sign in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" id="password" error={problem}>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="Confirm password" id="confirm" error={confirm && confirm !== password ? 'Passwords do not match' : null}>
          <input id="confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        {error && <p role="alert" className="rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-accent">{error}</p>}
        <button type="submit" className="btn-primary w-full py-3" disabled={busy || !password || Boolean(problem) || password !== confirm}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  );
}
