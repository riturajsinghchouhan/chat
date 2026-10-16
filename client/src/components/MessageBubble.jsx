import { memo, useRef, useState } from 'react';
import { AlertCircle, Ban, Check, CheckCheck, ChevronDown, Clock, Download, FileText, Forward, RotateCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '../lib/api';
import { cn, formatBytes, formatTime, idOf } from '../lib/utils';
import { useChat } from '../store/chatStore';
import { useUI } from '../store/uiStore';
import { downloadMedia } from '../hooks/useMediaUrl';
import MediaImage from './MediaImage';
import UserAvatar from './UserAvatar';
import MessageActionsMenu from './MessageActionsMenu';

const DELETE_WINDOW_MS = 60 * 60 * 1000;
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

function Linkified({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function StatusIcon({ status }) {
  if (status === 'sending') return <Clock size={13} aria-label="Sending" />;
  if (status === 'failed') return <AlertCircle size={13} aria-label="Failed" />;
  if (status === 'read') return <CheckCheck size={15} className="text-sky-200" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck size={15} aria-label="Delivered" />;
  return <Check size={14} aria-label="Sent" />;
}

function ReplyQuote({ reply, mine, onJump }) {
  if (!reply) return null;
  const label = reply.deletedAt
    ? 'Deleted message'
    : reply.type === 'image'
      ? `📷 ${reply.text || 'Photo'}`
      : reply.type === 'gif'
        ? 'GIF'
        : reply.type === 'file'
          ? `📄 ${reply.fileName || 'File'}`
          : reply.text;
  return (
    <button
      type="button"
      onClick={() => onJump?.(reply._id)}
      className={cn('mb-1.5 block w-full rounded-xl border-l-[3px] px-3 py-1.5 text-left text-xs', mine ? 'border-white/80 bg-black/15' : 'border-accent bg-accent-soft')}
    >
      <div className={cn('font-semibold', mine ? 'text-white' : 'text-accent')}>{reply.senderId?.name || 'Message'}</div>
      <div className="line-clamp-2 opacity-80">{label}</div>
    </button>
  );
}

function MessageBubble({ message, meId, mine, isGroup, showSender, showAvatar, conversation, onReply, onEdit, onJump, highlighted, galleryItems }) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const bubbleRef = useRef(null);
  const pressTimer = useRef(null);
  const convId = idOf(message.conversationId);
  const deleted = Boolean(message.deletedAt);
  const pending = message.status === 'sending' || message.status === 'failed';
  const pinned = conversation?.pinnedMessages?.some((p) => idOf(p) === message._id);

  const openMenu = (anchor) => {
    if (!pending) setMenuAnchor(anchor || bubbleRef.current);
  };

  const replaceFromServer = (msg) => useChat.getState().upsertMessages(convId, [msg]);

  const actions = {
    mine,
    canReact: !deleted && !pending,
    react: async (emoji) => {
      try {
        replaceFromServer((await api.post(`/messages/${message._id}/reactions`, { emoji })).data.message);
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    },
    reply: !deleted && !pending ? () => onReply(message) : null,
    copy:
      !deleted && message.text
        ? async () => {
            try {
              await navigator.clipboard.writeText(message.text);
              toast.success('Copied');
            } catch {
              toast.error('Clipboard is not available');
            }
          }
        : null,
    forward: !deleted && !pending ? () => useUI.getState().setForwarding(message) : null,
    pinned,
    pin:
      !deleted && !pending
        ? async () => {
            try {
              const { data } = await api.post(`/conversations/${convId}/pins`, { messageId: message._id });
              useChat.getState().upsertConversation({ _id: convId, pinnedMessages: data.pinnedMessages });
              toast.success(data.pinned ? 'Message pinned' : 'Message unpinned');
            } catch (err) {
              toast.error(getErrorMessage(err));
            }
          }
        : null,
    edit: mine && !deleted && !pending && ['text', 'image', 'file'].includes(message.type) ? () => onEdit(message) : null,
    deleteMe: !pending
      ? async () => {
          try {
            await api.delete(`/messages/${message._id}`, { params: { scope: 'me' } });
            useChat.getState().removeLocalMessage(convId, message._id);
          } catch (err) {
            toast.error(getErrorMessage(err));
          }
        }
      : null,
    deleteAll:
      mine && !deleted && !pending && Date.now() - new Date(message.createdAt).getTime() < DELETE_WINDOW_MS
        ? async () => {
            const ok = await useUI.getState().confirm({
              title: 'Delete for everyone?',
              message: 'This message will be removed for all participants.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            try {
              replaceFromServer((await api.delete(`/messages/${message._id}`, { params: { scope: 'everyone' } })).data.message);
            } catch (err) {
              toast.error(getErrorMessage(err));
            }
          }
        : null,
  };

  const reactionGroups = Object.values(
    (message.reactions || []).reduce((acc, r) => {
      acc[r.emoji] = acc[r.emoji] || { emoji: r.emoji, count: 0, mine: false };
      acc[r.emoji].count += 1;
      if (idOf(r.user) === meId) acc[r.emoji].mine = true;
      return acc;
    }, {}),
  );
  const myReaction = (message.reactions || []).find((r) => idOf(r.user) === meId)?.emoji;

  const openImage = () => {
    const items = galleryItems?.length ? galleryItems : [{ src: message.mediaUrl, caption: message.text, fileName: message.fileName, id: message._id }];
    const idx = Math.max(0, items.findIndex((i) => i.id === message._id));
    if (message.mediaUrl) useUI.getState().openLightbox(items, idx);
  };

  const isMedia = !deleted && (message.type === 'image' || message.type === 'gif');
  const maxW = message.width && message.height && message.height > message.width ? 240 : 320;

  return (
    <div
      id={`msg-${message._id}`}
      className={cn('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start', showSender ? 'mt-3' : 'mt-1')}
    >
      {!mine && isGroup && (
        <div className="w-8 shrink-0">{showAvatar && <UserAvatar src={message.senderId?.avatar} name={message.senderId?.name || '?'} size="xs" ring={false} />}</div>
      )}
      <div className={cn('relative flex max-w-[85%] flex-col sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        <div
          ref={bubbleRef}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu();
          }}
          onTouchStart={() => {
            pressTimer.current = setTimeout(() => openMenu(), 450);
          }}
          onTouchEnd={() => clearTimeout(pressTimer.current)}
          onTouchMove={() => clearTimeout(pressTimer.current)}
          className={cn(
            'touch-menu relative rounded-2xl text-[14.5px] leading-snug break-words whitespace-pre-wrap transition [overflow-wrap:anywhere]',
            isMedia ? 'p-1.5' : 'px-3.5 py-2',
            mine ? 'rounded-br-md bg-accent text-on-accent shadow-[4px_4px_12px_rgba(229,72,77,0.25)]' : 'neu-sm rounded-bl-md bg-bubble-in',
            message.status === 'failed' && 'opacity-80 ring-2 ring-accent/60',
            highlighted && 'highlight-flash',
          )}
        >
          {isGroup && !mine && showSender && <div className={cn('mb-0.5 text-xs font-bold text-accent', isMedia && 'px-2 pt-1')}>{message.senderId?.name || 'Deleted account'}</div>}
          {message.forwarded && !deleted && (
            <div className={cn('mb-1 flex items-center gap-1 text-[11px] italic opacity-75', isMedia && 'px-2 pt-1')}>
              <Forward size={12} /> Forwarded
            </div>
          )}
          {!deleted && <ReplyQuote reply={message.replyTo} mine={mine} onJump={onJump} />}

          {deleted ? (
            <span className="flex items-center gap-1.5 italic opacity-70">
              <Ban size={14} /> This message was deleted
            </span>
          ) : message.type === 'image' ? (
            <div className="relative">
              <MediaImage
                src={message.thumbnailUrl || message.mediaUrl}
                fallbackSrc={message.localPreview}
                alt={message.text || 'Photo'}
                width={message.width}
                height={message.height}
                className="min-w-40 cursor-zoom-in rounded-xl"
                style={{ maxWidth: maxW, width: message.width ? Math.min(maxW, message.width) : maxW }}
                onClick={pending ? undefined : openImage}
              />
              {message.status === 'sending' && message.uploadProgress !== undefined && message.uploadProgress < 100 && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 text-sm font-semibold text-white">{message.uploadProgress}%</div>
              )}
            </div>
          ) : message.type === 'gif' ? (
            <div className="relative">
              <img
                src={message.mediaUrl}
                alt={message.fileName || 'GIF'}
                loading="lazy"
                className="cursor-zoom-in rounded-xl bg-sunken object-cover"
                style={{ maxWidth: maxW, width: message.width ? Math.min(maxW, message.width) : maxW, aspectRatio: message.width && message.height ? `${message.width}/${message.height}` : undefined }}
                onClick={() => useUI.getState().openLightbox([{ src: message.mediaUrl, caption: 'GIF' }], 0)}
              />
              <span className="absolute top-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white">GIF</span>
            </div>
          ) : message.type === 'file' ? (
            <div className={cn('flex min-w-56 items-center gap-3 rounded-xl p-2', mine ? 'bg-black/15' : 'bg-sunken')}>
              <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', mine ? 'bg-white/20' : 'neu-accent')}>
                <FileText size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{message.fileName}</div>
                <div className="text-xs opacity-75">
                  {message.status === 'sending' && message.uploadProgress !== undefined && message.uploadProgress < 100
                    ? `Uploading ${message.uploadProgress}%`
                    : formatBytes(message.fileSize)}
                </div>
              </div>
              {!pending && message.mediaUrl && (
                <button
                  type="button"
                  className="icon-btn h-9 w-9 text-current hover:text-current"
                  aria-label="Download file"
                  onClick={() => downloadMedia(message.mediaUrl, message.fileName).catch((err) => toast.error(getErrorMessage(err, 'Download failed')))}
                >
                  <Download size={18} />
                </button>
              )}
            </div>
          ) : null}

          {!deleted && message.text && message.type !== 'text' && (
            <div className={cn(isMedia && 'px-2 pt-1.5')}>
              <Linkified text={message.text} />
            </div>
          )}
          {!deleted && message.type === 'text' && <Linkified text={message.text} />}

          <div className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10.5px] select-none', mine ? 'text-white/80' : 'text-muted', isMedia && 'px-2 pb-0.5')}>
            {pinned && <span title="Pinned">📌</span>}
            {message.editedAt && !deleted && <span>edited</span>}
            <span>{formatTime(message.createdAt)}</span>
            {mine && !deleted && <StatusIcon status={message.status} />}
          </div>

          {!pending && (
            <button
              type="button"
              aria-label="Message actions"
              onClick={(e) => openMenu(e.currentTarget)}
              className={cn(
                'absolute top-1 hidden h-6 w-6 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100 focus:opacity-100 sm:flex',
                mine ? 'right-1 bg-accent text-white' : 'right-1 bg-bubble-in text-muted',
              )}
            >
              <ChevronDown size={16} />
            </button>
          )}
        </div>

        {message.status === 'failed' && (
          <div className="mt-1 flex items-center gap-2 text-xs text-accent">
            <span>{message.error || 'Not sent'}</span>
            <button type="button" className="flex items-center gap-1 font-semibold underline" onClick={() => useChat.getState().deliver(convId, message.clientId)}>
              <RotateCw size={12} /> Retry
            </button>
            <button type="button" className="flex items-center gap-1 text-muted" onClick={() => useChat.getState().removeLocalMessage(convId, message.clientId)} aria-label="Discard">
              <X size={12} />
            </button>
          </div>
        )}

        {reactionGroups.length > 0 && (
          <div className={cn('relative z-10 -mt-1.5 flex flex-wrap gap-1', mine ? 'justify-end pr-2' : 'pl-2')}>
            {reactionGroups.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => actions.react(r.emoji)}
                className={cn('neu-sm flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', r.mine && 'ring-1 ring-accent')}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="text-muted">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {menuAnchor && <MessageActionsMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} actions={actions} myReaction={myReaction} />}
    </div>
  );
}

export default memo(MessageBubble);
