import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AuthContext } from './AuthContext';
import { getBadges } from '../services/inbox';

/**
 * App-wide badge counts. Fetches the consolidated `/notifications/badges` payload
 * (unread inbox + role-scoped pending sections + a grand total), keeps it fresh
 * (polling + on app foreground), and mirrors the grand total onto the OS app-icon
 * badge — the WhatsApp-style count on the launcher icon.
 *
 * Exposes:
 *   unread   number  — unread inbox notifications (the bell)
 *   sections object  — { leave, substitution, faces, holidays } pending counts
 *   total    number  — unread + sum(sections), also set on the app icon
 *   refresh  fn      — force an immediate re-fetch (call after acting on items)
 */
export const BadgeContext = createContext({ unread: 0, sections: {}, total: 0, refresh: () => {} });

const POLL_MS = 30000;

/**
 * Are two badge payloads the same? Compared field by field rather than by
 * JSON.stringify so key order from the API can never make an unchanged payload
 * look different.
 */
function sameCounts(a, b) {
  if (!a || !b) return false;
  if (a.unread !== b.unread || a.total !== b.total) return false;
  const ak = Object.keys(a.sections || {});
  const bk = Object.keys(b.sections || {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a.sections[k] === b.sections[k]);
}

export function BadgeProvider({ children }) {
  const { user } = useContext(AuthContext);
  const [state, setState] = useState({ unread: 0, sections: {}, total: 0 });
  const timer = useRef(null);

  const setAppIconBadge = (n) => {
    Notifications.setBadgeCountAsync(Math.max(0, n || 0)).catch(() => {});
  };

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getBadges();
      const next = { unread: res?.unread || 0, sections: res?.sections || {}, total: res?.total || 0 };

      // Bail out when the counts are identical to what we already hold.
      //
      // This poll fires every 30 seconds forever, and the overwhelming majority
      // of those responses say exactly what the last one said. Calling setState
      // regardless produced a new state object every 30s, which produced a new
      // context value, which re-rendered every badge consumer — the bell, the
      // sidebar, every section tab — perpetually, for no visible change. Now a
      // quiet poll costs nothing and only a real change repaints.
      setState((prev) => (sameCounts(prev, next) ? prev : next));
      setAppIconBadge(next.total);
    } catch (e) {
      // Non-fatal — keep the last known counts.
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setState({ unread: 0, sections: {}, total: 0 });
      setAppIconBadge(0);
      if (timer.current) clearInterval(timer.current);
      return;
    }

    refresh();
    timer.current = setInterval(refresh, POLL_MS);

    // Refresh the moment the app returns to the foreground.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });

    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, [user, refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);

  return (
    <BadgeContext.Provider value={value}>
      {children}
    </BadgeContext.Provider>
  );
}

export const useBadges = () => useContext(BadgeContext);
