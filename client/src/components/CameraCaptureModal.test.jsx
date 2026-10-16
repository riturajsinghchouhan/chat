import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadMedia = vi.fn();
const sendMessage = vi.fn();
vi.mock('../store/chatStore', () => ({
  uploadMedia: (...args) => uploadMedia(...args),
  useChat: { getState: () => ({ sendMessage }) },
}));

const probeVideo = vi.fn();
vi.mock('../lib/video', async (importOriginal) => ({
  ...(await importOriginal()),
  probeVideo: (...args) => probeVideo(...args),
}));

const { default: CameraCaptureModal } = await import('./CameraCaptureModal');

class FakeRecorder {
  static instances = [];
  static isTypeSupported = (t) => t === 'video/webm';
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.mimeType = options?.mimeType || 'video/webm';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['video-bytes'], { type: 'video/webm' }) });
    this.onstop?.();
  }
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } };
}

function makeVideoLive() {
  const video = screen.getByTestId('camera-video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
  act(() => video.onplaying?.());
}

beforeEach(() => {
  uploadMedia.mockReset();
  sendMessage.mockReset();
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb) {
    cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
  };
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function setMediaDevices(getUserMedia, devices = [{ kind: 'videoinput' }]) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn(() => Promise.resolve(devices)) },
  });
}

describe('CameraCaptureModal', () => {
  it('shows a helpful message when camera permission is denied', async () => {
    setMediaDevices(vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))));
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    expect(await screen.findByText('Camera permission denied')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose from device')).toBeInTheDocument();
  });

  it('reports a missing camera', async () => {
    setMediaDevices(vi.fn(() => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' }))));
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    expect(await screen.findByText('No camera found')).toBeInTheDocument();
  });

  it('captures, uploads and sends a photo, then releases the camera', async () => {
    const { stream, track } = fakeStream();
    setMediaDevices(vi.fn(() => Promise.resolve(stream)));
    uploadMedia.mockResolvedValue({ mediaId: 'm1', type: 'image' });
    const onClose = vi.fn();
    render(<CameraCaptureModal open onClose={onClose} conversationId="c1" />);

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('camera-video').srcObject).toBe(stream));
    // Capture is disabled until real frames arrive
    expect(screen.getByLabelText('Capture photo')).toBeDisabled();
    makeVideoLive();
    fireEvent.click(screen.getByLabelText('Capture photo'));

    expect(await screen.findByText('Retake')).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled(); // camera released while previewing
    fireEvent.change(screen.getByPlaceholderText('Add a caption…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const [convId, payload] = sendMessage.mock.calls[0];
    expect(convId).toBe('c1');
    expect(payload).toMatchObject({ type: 'image', text: 'hello', media: { mediaId: 'm1' } });
    expect(uploadMedia.mock.calls[0][1]).toBeInstanceOf(File);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the preview when the upload fails so the user can retry', async () => {
    const { stream } = fakeStream();
    setMediaDevices(vi.fn(() => Promise.resolve(stream)));
    uploadMedia.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('camera-video').srcObject).toBe(stream));
    makeVideoLive();
    fireEvent.click(screen.getByLabelText('Capture photo'));
    fireEvent.click(await screen.findByText('Send'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(screen.getByAltText('Captured')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();

    uploadMedia.mockResolvedValueOnce({ mediaId: 'm2' });
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
  });

  it('stops camera tracks when closed/unmounted', async () => {
    const { stream, track } = fakeStream();
    setMediaDevices(vi.fn(() => Promise.resolve(stream)));
    const { unmount } = render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('camera-video').srcObject).toBe(stream));
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('falls back to picking an image from the device', async () => {
    setMediaDevices(vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' }))));
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    await screen.findByText('No camera found');
    const file = new File(['png'], 'pic.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('camera-file-input'), { target: { files: [file] } });
    expect(await screen.findByAltText('Captured')).toBeInTheDocument();

    const bad = new File(['exe'], 'x.exe', { type: 'application/x-msdownload' });
    fireEvent.change(screen.getByTestId('camera-file-input'), { target: { files: [bad] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG, WebP, GIF');
  });

  it('records a video snap and hands it to the chat store for chunked upload', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    setMediaDevices(getUserMedia);
    FakeRecorder.instances = [];
    globalThis.MediaRecorder = FakeRecorder;
    const poster = new Blob(['jpg'], { type: 'image/jpeg' });
    probeVideo.mockResolvedValue({ duration: 3.2, width: 720, height: 1280, poster });
    const onClose = vi.fn();
    render(<CameraCaptureModal open onClose={onClose} conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('camera-video').srcObject).toBe(stream));

    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({ audio: true })));
    makeVideoLive();
    fireEvent.click(screen.getByLabelText('Start recording'));
    expect(FakeRecorder.instances[0].state).toBe('recording');
    expect(screen.getByRole('timer')).toHaveTextContent('0:00 / 0:30');
    fireEvent.click(screen.getByLabelText('Stop recording'));

    expect(await screen.findByTestId('video-preview')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Add a caption…'), { target: { value: 'snap' } });
    fireEvent.click(screen.getByLabelText('Send video'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [convId, payload] = sendMessage.mock.calls[0];
    expect(convId).toBe('c1');
    expect(payload).toMatchObject({ type: 'video', text: 'snap', videoMeta: { duration: 3.2, width: 720, height: 1280 }, poster });
    expect(payload.file).toBeInstanceOf(File);
    expect(payload.file.name).toMatch(/\.webm$/);
    expect(uploadMedia).not.toHaveBeenCalled(); // videos are uploaded by the store, in chunks
    expect(onClose).toHaveBeenCalled();
  });

  it('stops recording automatically at 30 seconds', async () => {
    const { stream } = fakeStream();
    setMediaDevices(vi.fn(() => Promise.resolve(stream)));
    FakeRecorder.instances = [];
    globalThis.MediaRecorder = FakeRecorder;
    probeVideo.mockResolvedValue({ duration: 30, width: 1280, height: 720, poster: null });
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('camera-video').srcObject).toBe(stream));
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    await waitFor(() => expect(screen.getByLabelText('Start recording')).toBeInTheDocument());
    makeVideoLive();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      fireEvent.click(screen.getByLabelText('Start recording'));
      act(() => vi.advanceTimersByTime(30_400));
    } finally {
      vi.useRealTimers();
    }
    expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(await screen.findByTestId('video-preview')).toBeInTheDocument();
  });

  it('rejects picked videos longer than 30 seconds', async () => {
    setMediaDevices(vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' }))));
    probeVideo.mockResolvedValue({ duration: 42, width: 1280, height: 720, poster: null });
    render(<CameraCaptureModal open onClose={() => {}} conversationId="c1" />);
    await screen.findByText('No camera found');
    const file = new File(['mp4'], 'long.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByTestId('camera-file-input'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 30 seconds');
    expect(screen.queryByTestId('video-preview')).not.toBeInTheDocument();
  });
});
