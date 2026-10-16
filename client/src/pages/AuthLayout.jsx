import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col bg-base">
      <div className="flex items-center justify-between p-5">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="card animate-pop w-full max-w-md p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, id, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error && <p className="mt-1.5 text-xs text-accent">{error}</p>}
    </div>
  );
}

/** Mirrors the server password policy for instant feedback. */
export function passwordProblem(pw) {
  if (pw.length < 8) return 'At least 8 characters';
  if (!/[A-Za-z]/.test(pw)) return 'Include a letter';
  if (!/\d/.test(pw)) return 'Include a number';
  return null;
}
