import { Lock, MessagesSquare } from 'lucide-react';
import Logo from '../components/Logo';

export default function HomePage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="neu flex h-28 w-28 items-center justify-center rounded-[36px]">
        <MessagesSquare size={44} className="text-accent" />
      </div>
      <div className="max-w-md space-y-2">
        <Logo />
        <p className="text-sm text-muted">Pick a conversation on the left, or start a new chat with the + button. Messages, photos and GIFs arrive instantly on every device you are signed in on.</p>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Lock size={12} /> Encrypted in transit (HTTPS/WSS). Not end-to-end encrypted.
      </p>
    </div>
  );
}
