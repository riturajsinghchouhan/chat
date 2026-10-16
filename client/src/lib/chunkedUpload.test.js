import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock('./api', () => ({ api }));
const { uploadChunked } = await import('./chunkedUpload');

const CHUNK = 4;
const file = new File(['0123456789'], 'clip.webm', { type: 'video/webm' }); // 3 chunks: 4 + 4 + 2
const media = { mediaId: 'v1', type: 'video' };
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const chunkIndexes = () => api.put.mock.calls.map(([url]) => Number(url.split('/').pop())).sort();

beforeEach(() => {
  vi.useRealTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.post.mockImplementation((url) =>
    Promise.resolve({ data: url === '/media/uploads' ? { uploadId: 'u1', chunkSize: CHUNK, totalChunks: 3 } : { media } }),
  );
  api.put.mockResolvedValue({ data: {} });
});

describe('uploadChunked', () => {
  it('uploads every chunk with its exact byte range, then completes with the poster', async () => {
    const progress = [];
    const poster = new Blob(['jpg'], { type: 'image/jpeg' });
    const result = await uploadChunked({ conversationId: 'c1', file, meta: { duration: 4.2 }, poster, onProgress: (p) => progress.push(p) });

    expect(result).toEqual(media);
    expect(api.post.mock.calls[0]).toEqual(['/media/uploads', expect.objectContaining({ conversationId: 'c1', size: 10, duration: 4.2 })]);
    expect(chunkIndexes()).toEqual([0, 1, 2]);
    const sizes = Object.fromEntries(api.put.mock.calls.map(([url, body]) => [url.split('/').pop(), body.size]));
    expect(sizes).toEqual({ 0: 4, 1: 4, 2: 2 });
    const [completeUrl, form] = api.post.mock.calls[1];
    expect(completeUrl).toBe('/media/uploads/u1/complete');
    expect(form.get('poster')).toBeTruthy();
    expect(progress.at(-1)).toBe(100);
  });

  it('retries a chunk that failed with a network error', async () => {
    vi.useFakeTimers();
    api.put.mockRejectedValueOnce(new Error('Network Error'));
    const promise = uploadChunked({ conversationId: 'c1', file, meta: { duration: 2 } });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual(media);
    expect(api.put).toHaveBeenCalledTimes(4);
  });

  it('resumes an interrupted upload, sending only the missing chunks', async () => {
    const state = {};
    api.put.mockImplementation((url) => (url.endsWith('/2') ? Promise.reject(httpError(400)) : Promise.resolve({ data: {} })));
    await expect(uploadChunked({ conversationId: 'c1', file, meta: { duration: 2 }, state })).rejects.toThrow('HTTP 400');
    expect(state.uploadId).toBe('u1');

    api.put.mockReset();
    api.put.mockResolvedValue({ data: {} });
    api.get.mockResolvedValue({ data: { uploadId: 'u1', chunkSize: CHUNK, totalChunks: 3, received: [0, 1] } });
    await expect(uploadChunked({ conversationId: 'c1', file, meta: { duration: 2 }, state })).resolves.toEqual(media);
    expect(api.get).toHaveBeenCalledWith('/media/uploads/u1');
    expect(chunkIndexes()).toEqual([2]);
    expect(api.post.mock.calls.filter(([url]) => url === '/media/uploads')).toHaveLength(1); // no new session
  });

  it('starts over when the upload session has expired', async () => {
    const state = { uploadId: 'old', chunkSize: CHUNK, totalChunks: 3 };
    api.get.mockRejectedValue(httpError(404));
    await expect(uploadChunked({ conversationId: 'c1', file, meta: { duration: 2 }, state })).resolves.toEqual(media);
    expect(state.uploadId).toBe('u1');
    expect(chunkIndexes()).toEqual([0, 1, 2]);
  });
});
