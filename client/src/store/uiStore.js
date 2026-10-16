import { create } from 'zustand';

const THEME_KEY = 'pulse-theme';

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#23262b' : '#e6eaf0');
}

export const useUI = create((set, get) => ({
  theme: readTheme(),
  setTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme() {
    const dark = document.documentElement.classList.contains('dark');
    get().setTheme(dark ? 'light' : 'dark');
  },

  infoPanelOpen: false,
  setInfoPanel: (open) => set({ infoPanelOpen: open }),

  // Image viewer: { items: [{ src, thumb, fileName, message }], index }
  lightbox: null,
  openLightbox: (items, index = 0) => set({ lightbox: { items, index } }),
  closeLightbox: () => set({ lightbox: null }),

  // Promise-based confirm dialog
  confirmState: null,
  confirm(options) {
    return new Promise((resolve) => {
      set({ confirmState: { ...options, resolve } });
    });
  },
  resolveConfirm(value) {
    get().confirmState?.resolve(value);
    set({ confirmState: null });
  },

  // Message to forward
  forwarding: null,
  setForwarding: (message) => set({ forwarding: message }),

  // Scroll-to-message requests from search/pins
  jumpTo: null,
  requestJump: (conversationId, messageId) => set({ jumpTo: { conversationId, messageId, at: Date.now() } }),
}));
