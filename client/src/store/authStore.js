import { create } from 'zustand';
import toast from 'react-hot-toast';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import { useChat } from './chatStore';

export const useAuth = create((set, get) => ({
  user: null,
  status: 'loading', // loading | authed | guest

  async init() {
    try {
      const { user } = await refreshSession();
      set({ user, status: 'authed' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },

  async login(identifier, password) {
    const { data } = await api.post('/auth/login', { identifier, password });
    setAccessToken(data.accessToken);
    set({ user: data.user, status: 'authed' });
  },

  async register(payload) {
    const { data } = await api.post('/auth/register', payload);
    setAccessToken(data.accessToken);
    set({ user: data.user, status: 'authed' });
  },

  async logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* clear locally regardless */
    }
    get().clearSession();
  },

  clearSession() {
    setAccessToken(null);
    disconnectSocket();
    useChat.getState().reset();
    set({ user: null, status: 'guest' });
  },

  setUser(user) {
    set({ user });
  },

  patchUser(patch) {
    const user = get().user;
    if (user) set({ user: { ...user, ...patch } });
  },
}));

setSessionExpiredHandler(() => {
  if (useAuth.getState().status === 'authed') {
    useAuth.getState().clearSession();
    toast.error('Your session expired. Please sign in again.');
  }
});
