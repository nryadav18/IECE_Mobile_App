import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// The one socket the app opens, used by the live Monitoring screen.
//
// It is created lazily and torn down the moment nothing is listening, so a
// phone that never opens Monitoring never holds a socket at all. The connection
// carries the same JWT the REST client uses; the server verifies it with the
// same tokenVersion rule, so a socket cannot outlive a session — and it is the
// server, from that token, that decides whose day this socket is allowed to
// stream. Nothing here asks for a scope, so nothing here can widen one.
// ---------------------------------------------------------------------------

// EXPO_PUBLIC_API_URL points at the REST base (".../api"); socket.io attaches to
// the ORIGIN, so the trailing /api is stripped.
const ORIGIN = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/api\/?$/, '');

let socket = null;
let refCount = 0;

/**
 * Acquire the shared socket. Every caller MUST call the returned release()
 * when it unmounts — the socket closes once the last holder lets go.
 */
export async function acquireSocket() {
  refCount += 1;

  if (!socket) {
    const token = await AsyncStorage.getItem('token');
    socket = io(ORIGIN, {
      auth: { token },
      // WebSocket first, but keep the polling fallback: corporate Wi-Fi and some
      // mobile carriers block upgrades, and a dashboard that silently stops
      // updating is worse than one on a slower transport.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 10000,
    });
  }

  return {
    socket,
    release() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0 && socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
    },
  };
}

export function isSocketConnected() {
  return !!socket && socket.connected;
}
