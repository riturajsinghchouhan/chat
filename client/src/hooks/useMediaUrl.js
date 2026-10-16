import { useEffect, useState } from 'react';
import { API_ORIGIN, api } from '../lib/api';

// Private chat media requires the Authorization header, which <img src> cannot send.
// We fetch it as a blob once, then reuse an object URL (small LRU cache).
const cache = new Map();
const inflight = new Map();
const MAX = 150;

function remember(url, objectUrl) {
  cache.set(url, objectUrl);
  if (cache.size > MAX) {
    const [oldKey, oldUrl] = cache.entries().next().value;
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

export function fetchPrivateMedia(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);
  const p = api
    .get(url.replace(/^\/api/, ''), { responseType: 'blob', timeout: 120000 })
    .then((res) => {
      const objectUrl = URL.createObjectURL(res.data);
      remember(url, objectUrl);
      return objectUrl;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

const isPrivate = (url) => typeof url === 'string' && url.startsWith('/api/media/');

/** Resolves a media URL to something an <img> can render. External URLs (GIFs) pass through. */
export function useMediaUrl(url, { enabled = true } = {}) {
  const [state, setState] = useState(() => ({
    src: !isPrivate(url) ? url : cache.get(url) || null,
    error: false,
  }));

  useEffect(() => {
    if (!url) {
      setState({ src: null, error: false });
      return undefined;
    }
    if (!isPrivate(url)) {
      setState({ src: url, error: false });
      return undefined;
    }
    if (cache.has(url)) {
      setState({ src: cache.get(url), error: false });
      return undefined;
    }
    if (!enabled) return undefined;
    let cancelled = false;
    fetchPrivateMedia(url)
      .then((src) => !cancelled && setState({ src, error: false }))
      .catch(() => !cancelled && setState({ src: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return state;
}

// Videos are played by the browser itself (<video src>), which streams them with HTTP Range
// requests. It cannot send the Authorization header, so it gets a short-lived signed link.
const streamLinks = new Map();

export async function getStreamUrl(url) {
  const cached = streamLinks.get(url);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.src;
  const { data } = await api.get(`${url.replace(/^\/api/, '')}/link`);
  const entry = { src: `${API_ORIGIN}${data.url}`, expiresAt: new Date(data.expiresAt).getTime() };
  streamLinks.set(url, entry);
  return entry.src;
}

export async function downloadMedia(url, fileName = 'download') {
  const { data } = await api.get(url.replace(/^\/api/, ''), { params: { download: 1 }, responseType: 'blob', timeout: 300000 });
  const objectUrl = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
