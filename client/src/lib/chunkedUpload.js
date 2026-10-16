// Resumable chunked uploads (used for videos).
// init → PUT chunks (a few in parallel, each retried with backoff) → complete.
// `state` is kept by the caller between attempts so a retry resumes instead of restarting.
import { api } from './api';

const CONCURRENCY = 3;
const RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isRetryableUploadError(err) {
  const status = err?.response?.status;
  return !status || status >= 500 || status === 408 || status === 429;
}

export async function uploadChunked({ conversationId, file, meta = {}, poster, onProgress, state = {} }) {
  let received = [];
  if (state.uploadId) {
    try {
      const { data } = await api.get(`/media/uploads/${state.uploadId}`);
      ({ received } = data);
      Object.assign(state, { chunkSize: data.chunkSize, totalChunks: data.totalChunks });
    } catch (err) {
      if (err?.response?.status !== 404) throw err;
      // Session gone: either "complete" already succeeded (its response was lost) or it expired.
      if (state.allSent) {
        try {
          return await complete(state, poster);
        } catch (completeErr) {
          if (completeErr?.response?.status !== 404) throw completeErr;
        }
      }
      Object.assign(state, { uploadId: null, allSent: false });
    }
  }
  if (!state.uploadId) {
    const { data } = await api.post('/media/uploads', {
      conversationId,
      fileName: file.name || 'video',
      size: file.size,
      duration: meta.duration,
      width: meta.width ? Math.round(meta.width) : undefined,
      height: meta.height ? Math.round(meta.height) : undefined,
    });
    Object.assign(state, { uploadId: data.uploadId, chunkSize: data.chunkSize, totalChunks: data.totalChunks, allSent: false });
  }

  const { uploadId, chunkSize, totalChunks } = state;
  const sizeOf = (i) => Math.min(chunkSize, file.size - i * chunkSize);
  const done = new Set(received);
  const loaded = new Map([...done].map((i) => [i, sizeOf(i)]));
  const report = () => onProgress?.(Math.min(99, Math.floor(([...loaded.values()].reduce((a, b) => a + b, 0) / file.size) * 100)));
  report();

  const queue = [];
  for (let i = 0; i < totalChunks; i += 1) if (!done.has(i)) queue.push(i);
  let failed = null;

  const sendChunk = async (i) => {
    const body = file.slice(i * chunkSize, i * chunkSize + sizeOf(i));
    for (let attempt = 0; ; attempt += 1) {
      try {
        await api.put(`/media/uploads/${uploadId}/chunks/${i}`, body, {
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: 60000,
          onUploadProgress: (e) => {
            loaded.set(i, Math.min(e.loaded, sizeOf(i)));
            report();
          },
        });
        loaded.set(i, sizeOf(i));
        report();
        return;
      } catch (err) {
        loaded.set(i, 0);
        if (failed || attempt >= RETRIES || !isRetryableUploadError(err)) throw err;
        await sleep(500 * 2 ** attempt);
      }
    }
  };

  const worker = async () => {
    while (queue.length && !failed) {
      const i = queue.shift();
      try {
        await sendChunk(i);
      } catch (err) {
        failed ||= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (failed) throw failed;
  state.allSent = true;
  const media = await complete(state, poster);
  onProgress?.(100);
  return media;
}

async function complete(state, poster) {
  const form = new FormData();
  if (poster) form.append('poster', poster, 'poster.jpg');
  const { data } = await api.post(`/media/uploads/${state.uploadId}/complete`, form, { timeout: 60000 });
  return data.media;
}
