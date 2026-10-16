import { useEffect, useState } from 'react';
import { api } from '../lib/api';

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
