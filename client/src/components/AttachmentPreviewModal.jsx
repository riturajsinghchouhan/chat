import { useEffect, useMemo, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import Modal from './Modal';
import { formatBytes } from '../lib/utils';

export default function AttachmentPreviewModal({ attachment, onCancel, onSend }) {
  const [caption, setCaption] = useState('');
  const url = useMemo(() => (attachment && attachment.type !== 'file' ? URL.createObjectURL(attachment.file) : null), [attachment]);
  useEffect(() => {
    setCaption('');
    return () => {
      // The chat store creates its own preview URL for the optimistic bubble.
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!attachment) return null;
  const { file, type } = attachment;
  const submit = (e) => {
    e.preventDefault();
    onSend(caption.trim());
  };

  return (
    <Modal open onClose={onCancel} title={type === 'image' ? 'Send photo' : type === 'video' ? 'Send video' : 'Send file'}>
      <form onSubmit={submit} className="space-y-4 px-5 pb-5">
        {type === 'image' ? (
          <div className="flex max-h-[50vh] justify-center overflow-hidden rounded-2xl bg-sunken">
            <img src={url} alt={file.name} className="max-h-[50vh] object-contain" />
          </div>
        ) : type === 'video' ? (
          <div className="flex max-h-[50vh] justify-center overflow-hidden rounded-2xl bg-black">
            <video src={url} controls playsInline className="max-h-[50vh] w-full object-contain" />
          </div>
        ) : (
          <div className="neu-inset flex items-center gap-3 rounded-2xl p-4">
            <div className="neu-accent flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
              <FileText size={22} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{file.name}</div>
              <div className="text-xs text-muted">{formatBytes(file.size)}</div>
            </div>
          </div>
        )}
        <input className="input" placeholder="Add a caption…" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={4000} autoFocus />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Send <Send size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
