// Helpers for short video clips ("snaps"): recording format, local probing and poster frames.

export const MAX_VIDEO_SECONDS = 30;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

// MP4 first: it plays everywhere (including iOS); WebM is the fallback on older Chromium/Firefox.
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const extensionForMime = (mime = '') => (mime.startsWith('video/mp4') ? 'mp4' : mime.startsWith('video/quicktime') ? 'mov' : 'webm');

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Reads duration/size of a local video and grabs a JPEG poster frame.
 * MediaRecorder WebM files report an Infinity duration until the end is seeked, so we
 * seek far past the end once to make the browser compute it.
 */
export function probeVideo(file, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;
    let fixingDuration = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('Could not read the video')), timeout);

    const grabPoster = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const result = { duration: video.duration, width: w || undefined, height: h || undefined, poster: null };
      if (!w || !h) return finish(resolve, result);
      const scale = Math.min(1, 720 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(resolve, { ...result, poster: blob }), 'image/jpeg', 0.8);
      } catch {
        finish(resolve, result);
      }
    };

    const seekToPoster = () => {
      video.onseeked = grabPoster;
      video.currentTime = Math.min(0.1, video.duration / 2);
    };

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) return seekToPoster();
      fixingDuration = true;
      video.currentTime = 1e101;
    };
    video.ondurationchange = () => {
      if (fixingDuration && Number.isFinite(video.duration)) {
        fixingDuration = false;
        seekToPoster();
      }
    };
    video.onerror = () => finish(reject, new Error('This video format is not supported'));
    video.src = url;
  });
}
