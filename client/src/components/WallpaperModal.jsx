import { useEffect, useRef, useState } from 'react';
import { Ban, Check, ImagePlus, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import ChatWallpaper from './ChatWallpaper';
import { api, getErrorMessage } from '../lib/api';
import { cn } from '../lib/utils';
import { WALLPAPER_COLORS, WALLPAPER_PRESETS, toWallpaperInput } from '../lib/wallpapers';
import { IMAGE_TYPES } from './CameraCaptureModal';
import { useAuth } from '../store/authStore';
import { useChat } from '../store/chatStore';

const MAX_BYTES = 10 * 1024 * 1024;
const same = (a, b) => JSON.stringify(toWallpaperInput(a)) === JSON.stringify(toWallpaperInput(b));

function Swatch({ selected, onClick, label, style, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={cn(
        'relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-line text-[11px] font-semibold text-muted transition hover:scale-[1.03]',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--panel)]',
      )}
      style={style}
    >
      {children}
      {selected && (
        <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/**
 * Pick, upload or change a chat wallpaper. With `conversation` it edits that chat
 * (or, via the scope switch, the default for all chats); without it, the default.
 */
export default function WallpaperModal({ open, onClose, conversation }) {
  const me = useAuth((s) => s.user);
  const [scope, setScope] = useState(conversation ? 'chat' : 'all');
  const [draft, setDraft] = useState(null);
  const [uploading, setUploading] = useState(null); // progress % while uploading
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const saved = scope === 'chat' ? (conversation?.me?.wallpaper ?? null) : (me.settings?.wallpaper ?? null);
  useEffect(() => {
    if (open) setDraft(saved);
    // Reset when opened or the scope changes, not on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope]);
  useEffect(() => {
    if (open) setScope(conversation ? 'chat' : 'all');
  }, [open, conversation]);

  // What the chat will look like: a chat without its own wallpaper shows the default.
  const preview = draft ?? (scope === 'chat' ? (me.settings?.wallpaper ?? null) : null);
  const shown = preview?.kind === 'none' ? null : preview;
  const pick = (w) => setDraft(w && { ...w, dim: w.kind === 'none' ? 0 : (draft?.dim ?? 0) });

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return toast.error('Choose a JPEG, PNG, WebP or GIF image');
    if (file.size > MAX_BYTES) return toast.error('Wallpaper must be 10 MB or smaller');
    const form = new FormData();
    form.append('wallpaper', file, file.name);
    setUploading(0);
    try {
      const { data } = await api.post('/users/wallpaper', form, {
        timeout: 120000,
        onUploadProgress: (ev) => ev.total && setUploading(Math.round((ev.loaded / ev.total) * 100)),
      });
      // Photos get a little dimming by default so bubbles stay readable.
      setDraft({ kind: 'image', mediaId: data.media.mediaId, url: data.media.url, dim: draft?.kind === 'image' ? draft.dim : 20 });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const wallpaper = toWallpaperInput(draft);
      if (scope === 'chat') {
        const { data } = await api.patch(`/conversations/${conversation._id}`, { wallpaper });
        useChat.getState().upsertConversation(data.conversation);
      } else {
        const { data } = await api.patch('/users/settings', { wallpaper });
        useAuth.getState().patchUser({ settings: data.user.settings });
      }
      toast.success(scope === 'chat' ? 'Chat wallpaper updated' : 'Default wallpaper updated');
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isPreset = (id) => draft?.kind === 'preset' && draft.value === id;
  const isColor = (c) => draft?.kind === 'color' && draft.value?.toLowerCase() === c;

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} title="Chat wallpaper" wide>
      <div className="grid gap-5 px-5 pb-5 sm:grid-cols-[200px_1fr]">
        {/* Live preview */}
        <div className="relative mx-auto aspect-[9/16] w-44 overflow-hidden rounded-3xl border border-line bg-base sm:w-full" data-testid="wallpaper-preview">
          <ChatWallpaper wallpaper={shown} />
          <div className="relative flex h-full flex-col justify-end gap-2 p-3 text-[12px]">
            <div className="neu-sm max-w-[80%] self-start rounded-2xl rounded-bl-md bg-bubble-in px-3 py-2">Hey! New wallpaper? 👀</div>
            <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-on-accent">Yes, looks great ✨</div>
          </div>
          {uploading !== null && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-white">Uploading {uploading}%</div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {conversation && (
            <div className="neu-inset flex rounded-full p-1 text-sm font-semibold" role="tablist" aria-label="Apply to">
              {[
                ['chat', 'This chat'],
                ['all', 'All chats (default)'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={scope === value}
                  onClick={() => setScope(value)}
                  className={cn('flex-1 rounded-full px-3 py-1.5 transition', scope === value ? 'bg-accent text-on-accent' : 'text-muted')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            <Swatch label="Upload a photo" onClick={() => fileRef.current?.click()} selected={draft?.kind === 'image'}>
              <span className="flex flex-col items-center gap-1">
                <ImagePlus size={18} className="text-accent" /> Photo
              </span>
            </Swatch>
            {scope === 'chat' && (
              <Swatch label="Use default wallpaper" onClick={() => setDraft(null)} selected={draft === null}>
                <span className="flex flex-col items-center gap-1 text-center">
                  <RotateCcw size={16} /> Default
                </span>
              </Swatch>
            )}
            <Swatch label="No wallpaper" onClick={() => pick({ kind: 'none' })} selected={draft?.kind === 'none' || (scope === 'all' && draft === null)}>
              <span className="flex flex-col items-center gap-1">
                <Ban size={16} /> None
              </span>
            </Swatch>
            {WALLPAPER_PRESETS.map((p) => (
              <Swatch key={p.id} label={p.name} style={{ background: p.background }} selected={isPreset(p.id)} onClick={() => pick({ kind: 'preset', value: p.id })} />
            ))}
          </div>

          <div>
            <div className="label">Colors</div>
            <div className="flex flex-wrap items-center gap-2">
              {WALLPAPER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={isColor(c)}
                  onClick={() => pick({ kind: 'color', value: c })}
                  className={cn('h-8 w-8 rounded-full border border-line transition hover:scale-110', isColor(c) && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--panel)]')}
                  style={{ background: c }}
                />
              ))}
              <label className="neu-sm flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted">
                Custom
                <input
                  type="color"
                  className="h-5 w-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  value={draft?.kind === 'color' ? draft.value : '#888888'}
                  onChange={(e) => pick({ kind: 'color', value: e.target.value })}
                  aria-label="Custom color"
                />
              </label>
            </div>
          </div>

          <label className={cn('block', (!draft || draft.kind === 'none') && 'pointer-events-none opacity-40')}>
            <span className="label flex justify-between">
              <span>Dim</span>
              <span>{draft?.dim || 0}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="80"
              step="5"
              value={draft?.dim || 0}
              disabled={!draft || draft.kind === 'none'}
              onChange={(e) => setDraft((d) => d && { ...d, dim: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
              aria-label="Dim wallpaper"
            />
          </label>

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving || uploading !== null || same(draft, saved)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={upload} data-testid="wallpaper-file" />
    </Modal>
  );
}
