/**
 * "Is the app under maintenance?"
 *
 * Asked at launch, on every return from the background, and repeatedly while
 * the maintenance screen is up. The answer comes from `GET /api/maintenance`,
 * which is public precisely so the screen can appear over the login screen —
 * during a deployment, signing in is the first thing that stops working.
 */

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const CACHE_KEY = 'maintenance:lastKnown';

/**
 * Is this a build that came from the Play Store or the App Store?
 *
 * The maintenance gate exists to hold real users out of a system being
 * migrated. It must NOT appear:
 *
 *   · **on the web** — the browser portal is how the switch gets turned off
 *     again. Gating it would mean the only way out of a lockout is the one
 *     thing the lockout had blocked.
 *   · **in development** — `__DEV__` covers Metro, and a maintenance window
 *     left switched on in the database should never stop the person who is
 *     mid-way through building the fix for it.
 *   · **in Expo Go, or a dev-client build** — both report `storeClient` in
 *     SDK 56, so excluding that one value covers both.
 *
 * An internal-distribution EAS build DOES get the gate, deliberately: it is a
 * production-flavoured binary pointed at the production database, so it is
 * subject to the same window as a store build.
 *
 * ── Why this EXCLUDES one value instead of requiring 'standalone' ────────
 *
 * `ExecutionEnvironment` has three values, and a release binary is not always
 * `standalone`: this project has committed native directories, and a build made
 * from them can report `bare` instead. Requiring `=== 'standalone'` would
 * therefore silently switch the gate OFF for exactly the builds it exists to
 * stop — and it would fail quietly, which is the worst way for a gate to fail.
 * Excluding `storeClient` is the check that stays correct either way: it names
 * the environments where the gate is unwanted rather than guessing at every
 * environment where it is.
 */
export function isStoreBuild() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  if (__DEV__) return false;
  if (Constants?.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  return true;
}

/**
 * The last positive answer the server gave, kept so the gate survives the one
 * case it would otherwise miss: the backend being unreachable *because* of the
 * deployment it was announcing.
 *
 * Stored as an absolute local-clock deadline rather than a duration, so it
 * still means something after the app has been closed and reopened.
 *
 * ONLY windows with a known end time are cached, and that is a safety rule
 * rather than a simplification. A cached window with no end has no moment at
 * which it stops applying, so a phone that never regains signal would sit
 * behind the screen for good with nothing able to release it. An open-ended
 * maintenance is only ever shown while the server is actually saying so.
 */
async function remember(info) {
  try {
    if (!info?.active || info.secondsRemaining == null) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        deadline: Date.now() + info.secondsRemaining * 1000,
        endsAtLabel: info.endsAtLabel || null,
        title: info.title || null,
        message: info.message || null,
      })
    );
  } catch {
    // A cache write failing must not break the check it was supposed to help.
  }
}

async function recall() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const left = Math.ceil((saved.deadline - Date.now()) / 1000);
    // Past its end — the window is over as far as this device can tell, so it
    // stops applying. This is the line that makes an offline block temporary.
    if (!(left > 0)) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return null;
    }
    return {
      active: true,
      secondsRemaining: left,
      endsAtLabel: saved.endsAtLabel || null,
      title: saved.title || null,
      message: saved.message || null,
      fromCache: true,
    };
  } catch {
    return null;
  }
}

/**
 * Ask the server.
 *
 * @returns the window when the app is under maintenance, otherwise null —
 *   including for every not-a-store-build case and every clean "no".
 *   A FAILED request falls back to the cached window, and to null when there
 *   is none: a check that could not be made must not be able to block anybody.
 */
export async function checkMaintenance() {
  if (!isStoreBuild()) return null;

  try {
    const res = await api.get('/maintenance');
    const data = res?.data?.data;

    if (!data?.active) {
      // A clean "no" clears the cache, so a window that ended early cannot be
      // resurrected by the next dropped connection.
      await remember(null);
      return null;
    }

    const info = {
      active: true,
      // The server counts, not the phone: a device with a wrong clock would
      // otherwise be either locked out indefinitely or let straight in.
      secondsRemaining:
        typeof data.secondsRemaining === 'number' ? Math.max(0, data.secondsRemaining) : null,
      endsAtLabel: data.endsAtLabel || null,
      title: data.title || null,
      message: data.message || null,
      fromCache: false,
    };
    await remember(info);
    return info;
  } catch {
    return recall();
  }
}
