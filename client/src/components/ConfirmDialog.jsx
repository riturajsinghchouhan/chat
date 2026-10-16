import { useEffect, useState } from 'react';
import Modal from './Modal';
import { useUI } from '../store/uiStore';

export default function ConfirmDialog() {
  const state = useUI((s) => s.confirmState);
  const resolve = useUI((s) => s.resolveConfirm);
  const [input, setInput] = useState('');
  useEffect(() => setInput(''), [state]);
  if (!state) return null;
  return (
    <Modal open onClose={() => resolve(false)} title={state.title || 'Are you sure?'}>
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          resolve(state.input ? input : true);
        }}
      >
        {state.message && <p className="text-sm text-muted">{state.message}</p>}
        {state.input && (
          <input
            className="input"
            type={state.input.type || 'text'}
            placeholder={state.input.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            required
          />
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button type="submit" className={state.danger ? 'btn-danger' : 'btn-primary'} autoFocus={!state.input}>
            {state.confirmLabel || 'Confirm'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
