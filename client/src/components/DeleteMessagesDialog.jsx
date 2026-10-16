import { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { getErrorMessage } from '../lib/api';
import { canDeleteForEveryone } from '../lib/messages';
import { useChat } from '../store/chatStore';

/** Confirms deleting one or more messages, offering "for everyone" only when every message allows it. */
export default function DeleteMessagesDialog({ open, conversationId, messages, meId, onClose, onDeleted }) {
  const [busy, setBusy] = useState(null); // 'me' | 'everyone' | null
  const count = messages.length;
  const forEveryone = count > 0 && messages.every((m) => canDeleteForEveryone(m, meId));

  const run = async (scope) => {
    setBusy(scope);
    try {
      await useChat.getState().deleteMessages(conversationId, messages.map((m) => m._id), scope);
      toast.success(`${count} message${count === 1 ? '' : 's'} deleted`);
      onDeleted?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete messages'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={`Delete ${count} message${count === 1 ? '' : 's'}?`}>
      <div className="space-y-4 px-5 pb-5">
        <p className="text-sm text-muted">
          {forEveryone
            ? 'Delete for everyone removes them for all participants. Delete for me only hides them on your devices.'
            : 'They will be removed from this chat on your devices. Other participants will still see them.'}
        </p>
        <div className="flex flex-col gap-2">
          {forEveryone && (
            <button type="button" className="btn-danger" disabled={Boolean(busy)} onClick={() => run('everyone')}>
              {busy === 'everyone' ? 'Deleting…' : 'Delete for everyone'}
            </button>
          )}
          <button type="button" className={forEveryone ? 'btn-ghost text-accent' : 'btn-danger'} disabled={Boolean(busy)} onClick={() => run('me')}>
            {busy === 'me' ? 'Deleting…' : 'Delete for me'}
          </button>
          <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
