import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
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
      setState(next);
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

  return (
    <BadgeContext.Provider value={{ ...state, refresh }}>
      {children}
    </BadgeContext.Provider>
  );
}

export const useBadges = () => useContext(BadgeContext);
