// Chat wallpapers: built-in presets (pure CSS, no downloads), solid colors and uploaded photos.

const pattern = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const dots = (color) =>
  pattern(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="2" cy="2" r="1.6" fill="${color}"/></svg>`);
const doodles = (color) =>
  pattern(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">` +
      '<path d="M14 20c4-6 10-6 14 0"/><circle cx="70" cy="18" r="6"/><path d="M58 60l8 8 14-16"/>' +
      '<path d="M18 70h16M26 62v16"/><path d="M80 84c-4-4-4-10 0-14"/><path d="M44 40l4-4 4 4-4 4z"/></svg>',
  );

export const WALLPAPER_PRESETS = [
  { id: 'sunset', name: 'Sunset', background: 'linear-gradient(160deg, #ff9a8b 0%, #ff6a88 55%, #ff99ac 100%)' },
  { id: 'ocean', name: 'Ocean', background: 'linear-gradient(160deg, #2193b0 0%, #6dd5ed 100%)' },
  { id: 'aurora', name: 'Aurora', background: 'linear-gradient(150deg, #0f2027 0%, #203a43 45%, #2c5364 100%)' },
  { id: 'peach', name: 'Peach', background: 'linear-gradient(160deg, #ffecd2 0%, #fcb69f 100%)' },
  { id: 'lavender', name: 'Lavender', background: 'linear-gradient(160deg, #e0c3fc 0%, #8ec5fc 100%)' },
  { id: 'forest', name: 'Forest', background: 'linear-gradient(160deg, #134e5e 0%, #71b280 100%)' },
  { id: 'midnight', name: 'Midnight', background: 'linear-gradient(170deg, #141e30 0%, #243b55 100%)' },
  { id: 'candy', name: 'Candy', background: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' },
  { id: 'dots-light', name: 'Dots', background: `${dots('rgba(0,0,0,0.12)')}, #eef1f5` },
  { id: 'dots-dark', name: 'Dots dark', background: `${dots('rgba(255,255,255,0.10)')}, #1c1f24` },
  { id: 'doodle-light', name: 'Doodles', background: `${doodles('rgba(229,72,77,0.18)')}, #fdf3f3` },
  { id: 'doodle-dark', name: 'Doodles dark', background: `${doodles('rgba(255,255,255,0.08)')}, #202328` },
];

export const WALLPAPER_COLORS = ['#f5e6d3', '#dfe7fd', '#d8f3dc', '#ffe5ec', '#fff3b0', '#2b2d42', '#1b263b', '#3a0ca3', '#264653', '#000000'];

export const presetById = (id) => WALLPAPER_PRESETS.find((p) => p.id === id) || null;

/** The wallpaper to show in a chat: the chat's own, else the user's default. `none` = plain. */
export function effectiveWallpaper(conversation, user) {
  const w = conversation?.me?.wallpaper ?? user?.settings?.wallpaper ?? null;
  return w && w.kind !== 'none' ? w : null;
}

/** Payload accepted by the API (the server derives the URL for images). */
export function toWallpaperInput(w) {
  if (!w) return null;
  const out = { kind: w.kind, dim: Math.round(w.dim || 0) };
  if (w.kind === 'preset' || w.kind === 'color') out.value = w.value;
  if (w.kind === 'image') out.mediaId = w.mediaId;
  return out;
}
