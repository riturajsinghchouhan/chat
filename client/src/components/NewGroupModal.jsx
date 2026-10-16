import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { useChat } from '../store/chatStore';
import Modal from './Modal';
import UserPicker from './UserPicker';

export default function NewGroupModal({ open, onClose }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelected([]);
      setName('');
      setDescription('');
    }
  }, [open]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/groups', { name: name.trim(), description: description.trim(), memberIds: selected.map((u) => u._id) });
      useChat.getState().upsertConversation(data.conversation);
      if (data.skipped) toast(`${data.skipped} user(s) could not be added`);
      onClose();
      navigate(`/c/${data.conversation._id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={step === 1 ? 'Add group members' : 'Group details'}>
      {step === 1 ? (
        <div className="space-y-4 px-5 pb-5">
          <UserPicker selected={selected} onChange={setSelected} />
          <button type="button" className="btn-primary w-full" disabled={!selected.length} onClick={() => setStep(2)}>
            Next ({selected.length} selected)
          </button>
        </div>
      ) : (
        <form className="space-y-4 px-5 pb-5" onSubmit={create}>
          <div>
            <label className="label" htmlFor="group-name">Group name</label>
            <input id="group-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="group-desc">Description (optional)</label>
            <textarea id="group-desc" className="input min-h-20 resize-none" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-muted">You will be the group admin. You can add a group photo after creating it.</p>
          <div className="flex gap-3">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
