import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PageShell({ title, back = '/', actions, children }) {
  return (
    <div className="flex h-full w-full flex-col bg-base">
      <header className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
        <Link to={back} className="icon-btn neu-sm" aria-label="Back">
          <ArrowLeft size={20} className="text-accent" />
        </Link>
        <h1 className="flex-1 truncate text-xl font-bold">{title}</h1>
        {actions}
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
