import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { getSocket } from '../lib/socket';
import { cn, isCoarsePointer, messagePreview } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useClickOutside } from '../hooks/useClickOutside';
import EmojiPicker from './EmojiPicker';
import GifPicker from './GifPicker';
import CameraCaptureModal from './CameraCaptureModal';
import FileUploadButton from './FileUploadButton';
import AttachmentPreviewModal from './AttachmentPreviewModal';
import { MAX_VIDEO_SECONDS, probeVideo } from '../lib/video';

const drafts = new Map();

export default function MessageComposer({ conversationId, replyTo, onCancelReply, editing, onCancelEdit, disabledReason }) {
  const [text, setText] = useState(() => drafts.get(conversationId) || '');
  const [panel, setPanel] = useState(null); // 'emoji' | 'gif' | null
  const [cameraOpen, setCameraOpen] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const typingRef = useRef({ active: false, timer: null });

  const closePanel = useCallback(() => setPanel(null), []);
  useClickOutside(panelRef, closePanel, Boolean(panel));

  const stopTyping = useCallback(() => {
    clearTimeout(typingRef.current.timer);
    if (typingRef.current.active) {
      getSocket()?.emit('typing:stop', { conversationId });
      typingRef.current.active = false;
    }
  }, [conversationId]);

  // Restore the draft when switching chats; stop typing on leave.
  useEffect(() => {
    setText(drafts.get(conversationId) || '');
    setPanel(null);
    return () => stopTyping();
  }, [conversationId, stopTyping]);

  useEffect(() => {
    if (editing) {
      setText(editing.text || '');
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Auto-grow textarea
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const onChange = (value) => {
    setText(value);
    if (!editing) drafts.set(conversationId, value);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (!typingRef.current.active) {
      getSocket()?.emit('typing:start', { conversationId });
      typingRef.current.active = true;
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 2500);
  };

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    stopTyping();
    if (editing) {
      try {
        const { data } = await api.patch(`/messages/${editing._id}`, { text: value });
        useChat.getState().upsertMessages(conversationId, [data.message]);
        onCancelEdit();
        setText(drafts.get(conversationId) || '');
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
      return;
    }
    setText('');
    drafts.delete(conversationId);
    useChat.getState().sendMessage(conversationId, { type: 'text', text: value, replyTo });
    onCancelReply?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer() && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (editing) onCancelEdit();
      else if (replyTo) onCancelReply();
    }
  };

  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const sendGif = (gif) => {
    setPanel(null);
    useChat.getState().sendMessage(conversationId, { type: 'gif', gif, replyTo });
    onCancelReply?.();
  };

  const pickAttachment = async (file, type) => {
    if (type !== 'video') return setAttachment({ file, type });
    try {
      const { poster, ...meta } = await probeVideo(file);
      if (!Number.isFinite(meta.duration) || meta.duration > MAX_VIDEO_SECONDS + 0.5) {
        return toast.error(`Videos can be at most ${MAX_VIDEO_SECONDS} seconds long`);
      }
      return setAttachment({ file, type, videoMeta: meta, poster });
    } catch (err) {
      return toast.error(getErrorMessage(err, 'This video could not be read'));
    }
  };

  const sendAttachment = (caption) => {
    const { file, type, videoMeta, poster } = attachment;
    setAttachment(null);
    useChat.getState().sendMessage(conversationId, { type, file, text: caption, replyTo, videoMeta, poster });
    onCancelReply?.();
  };

  if (disabledReason) {
    return <div className="safe-bottom border-t border-line px-4 pt-3 text-center text-sm text-muted">{disabledReason}</div>;
  }

  const banner = editing || replyTo;

  return (
    <div className="safe-bottom relative px-2 pt-2 sm:px-5">
      {banner && (
        <div className="neu-inset mb-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm">
          {editing ? <Pencil size={16} className="text-accent" /> : <Reply size={16} className="text-accent" />}
          <div className="min-w-0 flex-1 border-l-2 border-accent pl-3">
            <div className="text-xs font-semibold text-accent">{editing ? 'Editing message' : `Replying to ${replyTo.senderId?.name || 'message'}`}</div>
            <div className="truncate text-muted">{messagePreview({ ...(editing || replyTo), senderId: null })}</div>
          </div>
          <button type="button" className="icon-btn h-8 w-8" onClick={editing ? onCancelEdit : onCancelReply} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
      )}

      {panel && (
        <div ref={panelRef} className="animate-pop absolute bottom-full left-2 z-40 mb-2 sm:left-5">
          {panel === 'emoji' ? <EmojiPicker onSelect={insertEmoji} width={Math.min(340, window.innerWidth - 16)} height={Math.min(400, window.innerHeight - 220)} /> : <GifPicker onSelect={sendGif} onClose={closePanel} />}
        </div>
      )}

      <div className="flex items-end gap-2 sm:gap-3">
        <div className="neu-inset flex min-h-12 min-w-0 flex-1 items-end gap-0.5 rounded-[26px] px-1.5 py-1.5 sm:gap-1 sm:px-2">
          <button
            type="button"
            className={cn('icon-btn h-9 w-8 sm:w-9', panel === 'emoji' && 'text-accent')}
            onClick={() => setPanel((p) => (p === 'emoji' ? null : 'emoji'))}
            aria-label="Emoji"
            title="Emoji"
          >
            <Smile size={20} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={typeof window !== 'undefined' && window.innerWidth < 400 ? 'Message' : 'Type a message'}
            aria-label="Message"
            className="scroll-thin max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-5 outline-none placeholder:text-muted sm:max-h-40"
          />
          {!editing && (
            <>
              <button
                type="button"
                className={cn('icon-btn h-9 w-8 text-[11px] font-extrabold sm:w-9', panel === 'gif' && 'text-accent')}
                onClick={() => setPanel((p) => (p === 'gif' ? null : 'gif'))}
                aria-label="GIF"
                title="GIF"
              >
                GIF
              </button>
              <FileUploadButton onFile={pickAttachment} />
              <button type="button" className="icon-btn h-9 w-8 sm:w-9" onClick={() => setCameraOpen(true)} aria-label="Camera" title="Photo or video snap">
                <Camera size={19} />
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="neu-accent flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition hover:bg-accent-hover active:scale-95 disabled:opacity-50"
          aria-label={editing ? 'Save edit' : 'Send message'}
        >
          <SendHorizontal size={20} />
        </button>
      </div>

      <CameraCaptureModal open={cameraOpen} onClose={() => setCameraOpen(false)} conversationId={conversationId} replyTo={replyTo} onSent={onCancelReply} />
      <AttachmentPreviewModal attachment={attachment} onCancel={() => setAttachment(null)} onSend={sendAttachment} />
    </div>
  );
}
