import { io } from 'socket.io-client';
import { API_ORIGIN, getAccessToken, onTokenChange, refreshSession } from './api';

let socket = null;
let unsubscribeToken = null;

export function getSocket() {
  return socket;
}

/**
 * Creates the singleton socket. The access token is read on every (re)connect attempt,
 * so automatic reconnections always use the freshest token.
 */
export function connectSocket() {
  if (socket) return socket;
  socket = io(API_ORIGIN || window.location.origin, {
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000,
  });

  socket.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') {
      try {
        await refreshSession();
        socket?.connect();
      } catch {
        /* session handler in api.js deals with real expiry */
      }
    }
  });

  socket.on('auth:expired', async () => {
    try {
      await refreshSession();
      socket?.connect();
    } catch {
      /* ignore */
    }
  });

  // Extend the live connection whenever the access token is refreshed.
  unsubscribeToken = onTokenChange((token) => {
    if (token && socket?.connected) socket.emit('auth:refresh', { token });
  });

  return socket;
}

export function disconnectSocket() {
  unsubscribeToken?.();
  unsubscribeToken = null;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/** Emit with acknowledgement + timeout. Resolves with the ack payload or rejects. */
export function emitAck(event, payload, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('offline'));
      return;
    }
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) reject(new Error('timeout'));
      else if (!res?.ok) reject(Object.assign(new Error(res?.error?.message || 'Failed'), { error: res?.error }));
      else resolve(res);
    });
  });
}
