import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, ImagePlus, RefreshCw, RotateCcw, Send, SwitchCamera, X } from 'lucide-react';
import { getErrorMessage } from '../lib/api';
import { uploadMedia, useChat } from '../store/chatStore';
import { cn } from '../lib/utils';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function cameraErrorFor(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return { title: 'Camera permission denied', message: 'Allow camera access in your browser settings, or choose a photo from your device.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { title: 'No camera found', message: 'We could not find a camera on this device. You can choose a photo instead.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { title: 'Camera is busy', message: 'Another app or tab is using the camera. Close it and try again.' };
    case 'TimeoutError':
      return { title: 'Camera did not start', message: 'The camera took too long to respond. Try again, or choose a photo instead.' };
    default:
      return { title: 'Camera unavailable', message: 'The camera could not be started. You can choose a photo instead.' };
  }
}

export default function CameraCaptureModal({ open, onClose, conversationId, replyTo, onSent }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const attemptRef = useRef(0);
  const requestRef = useRef(Promise.resolve());
  const fileInputRef = useRef(null);
  const sentRef = useRef(false);

  const [phase, setPhase] = useState('starting'); // starting | live | preview | error
  const [error, setError] = useState(null);
  const [facing, setFacing] = useState('user');
  const [canSwitch, setCanSwitch] = useState(false);
  const [shot, setShot] = useState(null); // { file, url }
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  const stopStream = useCallback(() => {
    attemptRef.current += 1; // invalidate any pending getUserMedia call
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startStream = useCallback(
    async (facingMode) => {
      stopStream();
      const attempt = attemptRef.current;
      setPhase('starting');
      setError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError({
          title: 'Camera unavailable',
          message: !window.isSecureContext ? 'Camera access requires HTTPS.' : 'This browser does not support camera access.',
        });
        setPhase('error');
        return;
      }
      try {
        // Serialize requests: overlapping getUserMedia calls on one device can stall in Chromium.
        await requestRef.current.catch(() => {});
        if (attempt !== attemptRef.current) return;
        const request = navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        requestRef.current = request;
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 15000);
        });
        const stream = await Promise.race([request, timeout]).finally(() => clearTimeout(timer));
        if (attempt !== attemptRef.current) {
          stream.getTracks().forEach((t) => t.stop()); // modal closed or switched meanwhile
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          // Browsers report a tiny placeholder size (e.g. 2x2) until real frames arrive;
          // only enable capture once actual video frames are decoding.
          const markLive = () => {
            if (attempt === attemptRef.current && video.videoWidth >= 16) setPhase('live');
          };
          video.onloadeddata = markLive;
          video.onplaying = markLive;
          video.onresize = markLive;
          video.srcObject = stream;
          video.play().catch(() => {});
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      } catch (err) {
        if (attempt !== attemptRef.current) return;
        // If the request eventually succeeds after a timeout, release the camera.
        if (err?.name === 'TimeoutError') requestRef.current.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        setError(cameraErrorFor(err));
        setPhase('error');
      }
    },
    [stopStream],
  );

  // Start when opened; always release the camera when closed or unmounted.
  useEffect(() => {
    if (!open) return undefined;
    sentRef.current = false;
    setShot(null);
    setCaption('');
    setUploadError(null);
    setProgress(0);
    startStream(facing);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    stopStream();
    if (shot && !sentRef.current) URL.revokeObjectURL(shot.url);
    setShot(null);
    onClose();
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 16) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError({ title: 'Capture failed', message: 'Could not capture the photo. Please try again.' });
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopStream();
        setShot({ file, url: URL.createObjectURL(blob) });
        setPhase('preview');
      },
      'image/jpeg',
      0.9,
    );
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setUploadError(null);
    setProgress(0);
    startStream(facing);
  };

  const switchCamera = () => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    startStream(next);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setUploadError('Please choose a JPEG, PNG, WebP or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError('Images must be 10 MB or smaller.');
      return;
    }
    stopStream();
    if (shot) URL.revokeObjectURL(shot.url);
    setUploadError(null);
    setShot({ file, url: URL.createObjectURL(file) });
    setPhase('preview');
  };

  const send = async () => {
    if (!shot || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const media = await uploadMedia(conversationId, shot.file, setProgress);
      sentRef.current = true;
      useChat.getState().sendMessage(conversationId, { type: 'image', text: caption.trim(), media, localPreview: shot.url, replyTo });
      onSent?.();
      setShot(null);
      onClose();
    } catch (err) {
      // Keep the preview so the user can retry without retaking the photo.
      setUploadError(getErrorMessage(err, 'Upload failed. Check your connection and try again.'));
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--overlay)] sm:p-4" role="dialog" aria-modal="true" aria-label="Camera">
      <div className="card animate-pop flex h-full w-full flex-col overflow-hidden bg-panel sm:h-auto sm:max-h-[92dvh] sm:max-w-xl sm:rounded-3xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-lg font-bold">{phase === 'preview' ? 'Preview' : 'Take a photo'}</h2>
          <button type="button" className="icon-btn neu-sm h-9 w-9" onClick={close} aria-label="Close camera">
            <X size={18} />
          </button>
        </div>

        <div className="relative mx-4 flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-3xl bg-black sm:aspect-[4/3] sm:flex-none">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            data-testid="camera-video"
            className={cn('absolute inset-0 h-full w-full object-cover transition-opacity', facing === 'user' && '-scale-x-100', phase !== 'live' && 'pointer-events-none opacity-0')}
          />
          {phase === 'starting' && (
            <div className="relative flex flex-col items-center gap-3 px-6 text-center text-white/80">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/70 border-t-transparent" />
              <span className="text-sm">Starting camera… allow access if your browser asks.</span>
            </div>
          )}
          {phase === 'error' && (
            <div className="relative flex max-w-sm flex-col items-center gap-3 p-6 text-center text-white">
              <CameraOff size={36} className="text-accent" />
              <div className="font-semibold">{error?.title}</div>
              <p className="text-sm text-white/70">{error?.message}</p>
              <button type="button" className="btn bg-white/10 text-white hover:bg-white/20" onClick={() => startStream(facing)}>
                <RefreshCw size={16} /> Try again
              </button>
            </div>
          )}
          {phase === 'preview' && shot && <img src={shot.url} alt="Captured" className="relative h-full w-full object-contain" />}
          {uploading && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <div className="space-y-3 p-4 safe-bottom">
          {uploadError && (
            <p role="alert" className="rounded-2xl bg-accent-soft px-4 py-2 text-sm text-accent">
              {uploadError}
            </p>
          )}

          {phase === 'preview' ? (
            <>
              <input
                className="input"
                placeholder="Add a caption…"
                value={caption}
                maxLength={4000}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                disabled={uploading}
              />
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="btn-ghost" onClick={retake} disabled={uploading}>
                  <RotateCcw size={16} /> Retake
                </button>
                <button type="button" className="btn-primary min-w-28" onClick={send} disabled={uploading}>
                  {uploading ? `Uploading ${progress}%` : uploadError ? 'Retry' : 'Send'} <Send size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <button type="button" className="icon-btn neu-sm h-12 w-12" onClick={() => fileInputRef.current?.click()} aria-label="Choose from device" title="Choose from device">
                <ImagePlus size={20} />
              </button>
              <button
                type="button"
                className="neu-accent flex h-16 w-16 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40"
                onClick={capture}
                disabled={phase !== 'live'}
                aria-label="Capture photo"
              >
                <Camera size={26} />
              </button>
              <button
                type="button"
                className="icon-btn neu-sm h-12 w-12"
                onClick={switchCamera}
                disabled={!canSwitch || phase !== 'live'}
                aria-label="Switch camera"
                title="Switch camera"
              >
                <SwitchCamera size={20} />
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={pickFile} data-testid="camera-file-input" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
