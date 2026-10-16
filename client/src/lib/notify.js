// Browser notifications + a tiny synthesized "pop" sound (no audio assets needed).
const DISMISS_KEY = 'pulse-notify-dismissed';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export function shouldOfferNotificationPrompt() {
  if (!notificationsSupported() || Notification.permission !== 'default') return false;
  try {
    return localStorage.getItem(DISMISS_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissNotificationPrompt() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  if (result !== 'granted') dismissNotificationPrompt(); // never re-prompt after a denial
  return result;
}

export function showBrowserNotification({ title, body, icon, tag, onClick }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: icon || '/favicon.svg', tag, silent: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

let audioCtx;
export function playMessageSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    /* audio blocked until first user gesture */
  }
}
