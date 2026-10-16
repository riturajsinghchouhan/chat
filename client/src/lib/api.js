import axios from 'axios';

export const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let accessToken = null;
let onSessionExpired = () => {};
const tokenListeners = new Set();

export const getAccessToken = () => accessToken;
export function setAccessToken(token) {
  accessToken = token;
  tokenListeners.forEach((fn) => fn(token));
}
export const onTokenChange = (fn) => {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
};
export const setSessionExpiredHandler = (fn) => {
  onSessionExpired = fn;
};

export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  withCredentials: true, // sends the httpOnly refresh cookie to /api/auth/*
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshPromise = null;
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_ORIGIN}/api/auth/refresh`, null, { withCredentials: true, timeout: 15000 })
      .then((res) => {
        setAccessToken(res.data.accessToken);
        return res.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const url = original?.url || '';
    if (status === 401 && original && !original._retried && !url.startsWith('/auth/')) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch (refreshError) {
        if (refreshError.response?.status === 401) onSessionExpired();
        throw error;
      }
    }
    throw error;
  },
);

export function getErrorMessage(error, fallback = 'Something went wrong') {
  if (error?.response?.data?.error?.message) return error.response.data.error.message;
  if (error?.error?.message) return error.error.message; // socket ack errors
  if (error?.code === 'ERR_NETWORK' || error?.message === 'Network Error') return 'Network error — check your connection';
  if (error?.code === 'ECONNABORTED') return 'The request timed out';
  return error?.message && !/status code/i.test(error.message) ? error.message : fallback;
}

/** Absolute URL for public resources served by the API (avatars). */
export function publicUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path) || path.startsWith('blob:') || path.startsWith('data:')) return path;
  return `${API_ORIGIN}${path}`;
}
