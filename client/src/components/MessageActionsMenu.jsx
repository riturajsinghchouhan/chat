import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Copy, Forward, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import EmojiPicker from './EmojiPicker';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageActionsMenu({ anchor, onClose, actions, myReaction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const [picker, setPicker] = useState(false);
  useClickOutside(ref, onClose, true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    let left = actions.mine ? r.right - w : r.left;
    left = Math.min(Math.max(8, left), vw - w - 8);
    setPos({ top, left });
  }, [anchor, actions.mine, picker]);

  const item = (Icon, label, onClick, danger) => (
    <button
      type="button"
      className={`menu-item ${danger ? 'text-accent' : ''}`}
      onClick={() => {
        onClick();
        onClose();
      }}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return createPortal(
    <div ref={ref} className="fixed z-[90]" style={pos} role="menu">
      {picker ? (
        <EmojiPicker
          width={Math.min(320, window.innerWidth - 16)}
          height={360}
          onSelect={(emoji) => {
            actions.react(emoji);
            onClose();
          }}
        />
      ) : (
        <div className="menu animate-pop w-56">
          {actions.canReact && (
            <div className="mb-1 flex items-center justify-between px-1 py-1">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`rounded-full p-1 text-xl transition hover:scale-125 ${myReaction === e ? 'bg-accent-soft' : ''}`}
                  onClick={() => {
                    actions.react(e);
                    onClose();
                  }}
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
              <button type="button" className="icon-btn h-8 w-8" onClick={() => setPicker(true)} aria-label="More reactions">
                <SmilePlus size={18} />
              </button>
            </div>
          )}
          {actions.reply && item(Reply, 'Reply', actions.reply)}
          {actions.copy && item(Copy, 'Copy text', actions.copy)}
          {actions.forward && item(Forward, 'Forward', actions.forward)}
          {actions.pin && item(actions.pinned ? PinOff : Pin, actions.pinned ? 'Unpin' : 'Pin', actions.pin)}
          {actions.edit && item(Pencil, 'Edit', actions.edit)}
          {actions.select && item(CheckSquare, 'Select', actions.select)}
          {actions.deleteMe && item(Trash2, 'Delete for me', actions.deleteMe, true)}
          {actions.deleteAll && item(Trash2, 'Delete for everyone', actions.deleteAll, true)}
        </div>
      )}
    </div>,
    document.body,
  );
}
