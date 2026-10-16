import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChat } from '../store/chatStore';
import { useAuth } from '../store/authStore';
import { cn, conversationDisplay } from '../lib/utils';
import SharedMediaGrid from '../components/SharedMediaGrid';
import PageShell from './PageShell';

export default function SharedMediaPage() {
  const { conversationId } = useParams();
  const me = useAuth((s) => s.user);
  const conversation = useChat((s) => s.conversations[conversationId]);
  const [tab, setTab] = useState('media');
  const name = conversation ? conversationDisplay(conversation, me._id).name : 'Chat';

  return (
    <PageShell title={`Shared media · ${name}`} back={`/c/${conversationId}`}>
      <div className="neu-inset mb-5 grid grid-cols-2 gap-1 rounded-2xl p-1">
        {[
          ['media', 'Photos & GIFs'],
          ['files', 'Files'],
        ].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn('rounded-xl py-2 text-sm font-semibold', tab === key ? 'neu-sm text-accent' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>
      <SharedMediaGrid key={tab} conversationId={conversationId} kind={tab} columns={4} />
    </PageShell>
  );
}
