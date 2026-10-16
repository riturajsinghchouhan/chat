import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api, getErrorMessage } from '../lib/api';
import AuthLayout, { Field } from './AuthLayout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(data.message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a reset link."
      footer={
        <Link to="/login" className="font-semibold text-accent">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="neu flex h-16 w-16 items-center justify-center rounded-2xl text-accent">
            <MailCheck />
          </div>
          <p className="text-sm text-muted">{sent}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" id="email">
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
          </Field>
          {error && <p role="alert" className="rounded-2xl bg-accent-soft px-4 py-2.5 text-sm text-accent">{error}</p>}
          <button type="submit" className="btn-primary w-full py-3" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
