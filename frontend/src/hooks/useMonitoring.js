import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import api from '../services/api';
import { acquireSocket } from '../services/monitoringSocket';

// ---------------------------------------------------------------------------
// Live feed for the Monitoring dashboard.
//
// The hook is scope-agnostic on purpose: it asks for "the monitoring data" and
// the server answers with whatever this viewer is entitled to — the whole
// organisation for the Admin and CEO, their own teams for a head, their own
// trainers for a leader. There is no scope parameter to get wrong, and no way
// for a client to request somebody else's people.
//
// Three rules shape it:
//
//  1. TODAY is push-driven. The server recomputes and emits at most once a
//     second and only when something actually changed, so there is no polling
//     loop burning battery or hammering Mongo.
//  2. A PAST day is a frozen fact. It is fetched once over REST and no socket is
//     opened for it at all — nothing about a finished day can change.
//  3. It must never be able to go silently stale. If the socket cannot connect
//     (blocked upgrade, offline server), a REST poll takes over automatically
//     and steps aside again the moment the socket comes up.
//
// The screen is also paused while the app is backgrounded or the tab is hidden,
// which is what keeps it from being a battery drain.
// ---------------------------------------------------------------------------

// How long to wait for the socket before falling back to polling.
const FALLBACK_AFTER_MS = 6000;
// Fallback cadence. Deliberately slower than the socket's 1s: this path exists
// to keep the screen honest, not to emulate a live feed over HTTP.
const FALLBACK_POLL_MS = 10000;

export default function useMonitoring(dateKey, { enabled = true } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const releaseRef = useRef(null);
  const pollRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const aliveRef = useRef(true);
  // The date the hook is currently serving. Guards against a slow response for
  // a previous date landing after the user has already moved on.
  const dateRef = useRef(dateKey);
  dateRef.current = dateKey;

  const apply = useCallback((data, forDate) => {
    if (!aliveRef.current || forDate !== dateRef.current) return;
    setSnapshot(data);
    setUpdatedAt(Date.now());
    setLoading(false);
    setError(null);
  }, []);

  const fetchOnce = useCallback(async (forDate) => {
    try {
      const res = await api.get('/monitoring/live', { params: { date: forDate } });
      apply(res.data.data, forDate);
    } catch (err) {
      if (!aliveRef.current || forDate !== dateRef.current) return;
      setError(err.response?.data?.error || 'Could not load monitoring data');
      setLoading(false);
    }
  }, [apply]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((forDate) => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => fetchOnce(forDate), FALLBACK_POLL_MS);
  }, [fetchOnce]);

  /** Manual refresh — pull-to-refresh and the "reconnect" tap both use it. */
  const refresh = useCallback(() => fetchOnce(dateRef.current), [fetchOnce]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    const forDate = dateKey;

    setLoading(true);
    setSnapshot(null);
    setConnected(false);

    // Always paint from REST first: the screen shows real numbers immediately
    // rather than waiting on a handshake.
    fetchOnce(forDate);

    const isToday = forDate === todayKey();

    if (!enabled || !isToday) {
      // A past day never streams — and neither does a paused screen.
      return () => { cancelled = true; stopPolling(); };
    }

    // Held so the exact listeners this effect added can be removed on cleanup,
    // rather than relying on the shared socket being torn down.
    let detach = null;

    (async () => {
      const handle = await acquireSocket();
      if (cancelled) { handle.release(); return; }
      releaseRef.current = handle.release;
      const { socket } = handle;

      const onSnapshot = (data) => {
        // Only today streams, so ignore anything for a different day — this can
        // happen for a second around IST midnight.
        if (data?.dateKey && data.dateKey !== dateRef.current) return;
        apply(data, dateRef.current);
      };
      const onConnect = () => {
        setConnected(true);
        stopPolling();               // socket wins; drop the fallback
        socket.emit('monitoring:join');
      };
      const onDisconnect = () => {
        setConnected(false);
        startPolling(dateRef.current);
      };

      // The server sends a heartbeat instead of a full payload when nothing has
      // changed, so "updated 2s ago" stays truthful without re-sending data the
      // screen already has.
      const onHeartbeat = () => { if (aliveRef.current) setUpdatedAt(Date.now()); };
      const onRealtimeError = (e) => setError(e?.message || 'Realtime error');

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onDisconnect);
      socket.on('monitoring:snapshot', onSnapshot);
      socket.on('monitoring:heartbeat', onHeartbeat);
      socket.on('monitoring:error', onRealtimeError);

      detach = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onDisconnect);
        socket.off('monitoring:snapshot', onSnapshot);
        socket.off('monitoring:heartbeat', onHeartbeat);
        socket.off('monitoring:error', onRealtimeError);
        if (socket.connected) socket.emit('monitoring:leave');
      };
      if (cancelled) { detach(); return; }

      if (socket.connected) onConnect();

      // If the handshake never lands, don't leave the screen frozen.
      fallbackTimerRef.current = setTimeout(() => {
        if (!socket.connected) startPolling(dateRef.current);
      }, FALLBACK_AFTER_MS);
    })();

    return () => {
      cancelled = true;
      stopPolling();
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (detach) { detach(); detach = null; }
      if (releaseRef.current) { releaseRef.current(); releaseRef.current = null; }
    };
  }, [dateKey, enabled, apply, fetchOnce, startPolling, stopPolling]);

  // Backgrounding the app should stop the stream; returning should resync at
  // once rather than waiting for the next server-side change.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => () => { aliveRef.current = false; }, []);

  return { snapshot, loading, error, connected, updatedAt, refresh };
}

/** 'YYYY-MM-DD' for the current IST day — mirrors the server's istDateKey. */
export function todayKey() {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
