import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { cn, conversationDisplay, messagePreview } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import Modal from './Modal';
import UserAvatar from './UserAvatar';

export default function ForwardModal({ meId }) {
  const message = useUI((s) => s.forwarding);
  const close = () => useUI.getState().setForwarding(null);
  const conversations = useChat((s) => s.conversations);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(
    () =>
      Object.values(conversations)
        .map((c) => ({ c, d: conversationDisplay(c, meId) }))
        .filter(({ d }) => !d.deleted && d.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => new Date(b.c.lastMessageAt) - new Date(a.c.lastMessageAt)),
    [conversations, meId, query],
  );

  if (!message) return null;

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/messages/${message._id}/forward`, { conversationIds: selected });
      toast.success(`Forwarded to ${selected.length} chat${selected.length > 1 ? 's' : ''}`);
      setSelected([]);
      close();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={close} title="Forward message">
      <div className="space-y-4 px-5 pb-5">
        <div className="neu-inset truncate rounded-2xl px-4 py-2.5 text-sm text-muted">{messagePreview({ ...message, senderId: null })}</div>
        <label className="neu-inset flex items-center gap-2 rounded-2xl px-4 py-2.5">
          <Search size={16} className="text-muted" />
          <input className="w-full bg-transparent text-sm outline-none" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {list.map(({ c, d }) => (
            <button key={c._id} type="button" onClick={() => toggle(c._id)} className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-accent-soft', selected.includes(c._id) && 'bg-accent-soft')}>
              <UserAvatar src={d.avatar} name={d.name} size="sm" group={c.type === 'group'} />
              <span className="flex-1 truncate text-sm font-semibold">{d.name}</span>
              {selected.includes(c._id) && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">Select up to 5 chats.</p>
        <button type="button" className="btn-primary w-full" disabled={!selected.length || busy} onClick={send}>
          {busy ? 'Forwarding…' : `Forward${selected.length ? ` (${selected.length})` : ''}`}
        </button>
      </div>
    </Modal>
  );
}
