/**
 * Everything Home needs to know about today, in one hook.
 *
 * Resolves the day's occasions, folds in admin overrides, rotates between
 * multiple occasions, rolls over at midnight, and fires the once-a-day haptic.
 *
 * Two things it deliberately does NOT do:
 *   · **block on the network.** The catalogue is bundled, so the header is
 *     correct on first paint, offline, on a cold start, always. Overrides load
 *     from AsyncStorage immediately and refresh from the API in the background;
 *     if that fails, nothing visible happens.
 *   · **keep timers alive off-screen.** Home is never unmounted — the stack
 *     keeps it under every portal — so the rotation timer is gated on the same
 *     `paused` flag the animations are.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import { makeCalendar } from './resolve';
import { themeForOccasion } from './palette';
import { fromYmd, ymd } from './dates';

/** How long each occasion holds the header before handing over. */
export const CYCLE_MS = 6500;

const OVERRIDES_KEY = 'celebrations:overrides';
const HAPTIC_DAY_KEY = 'celebrations:lastHapticDay';

/**
 * expo-haptics is optional at runtime on purpose.
 *
 * A JS bundle can update ahead of the native build it runs inside (that is the
 * whole point of an OTA-style update), and a missing native module would
 * otherwise take the home screen down. A celebration that doesn't buzz is not
 * a bug worth crashing for.
 */
let Haptics = null;
try {
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

/** Milliseconds until the next local midnight. */
function msUntilMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * @param {object}  opts
 * @param {boolean} opts.isDark
 * @param {boolean} opts.paused    stop the rotation timer (screen off-focus)
 * @param {boolean} opts.enabled   resolve at all
 * @param {string}  opts.previewDateKey  'YYYY-MM-DD' — pretend it is this day.
 *   This is what makes the admin preview honest: it doesn't build a mock, it
 *   hands the real Home screen a different date and lets everything downstream
 *   behave exactly as it will on the morning itself.
 * @param {string}  opts.previewOccasionKey  pin one occasion of a multi-occasion
 *   day instead of rotating, so the admin can hold a single scene still.
 */
export default function useOccasions({
  isDark,
  paused = false,
  enabled = true,
  previewDateKey = null,
  previewOccasionKey = null,
} = {}) {
  const [overrides, setOverrides] = useState(null);
  const [today, setToday] = useState(() => new Date());
  const [index, setIndex] = useState(0);

  /* --- overrides: cache first, network second, never blocking -------- */
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;

    AsyncStorage.getItem(OVERRIDES_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setOverrides(parsed);
      })
      .catch(() => {});

    api
      .get('/occasions')
      .then((res) => {
        const list = res?.data?.data;
        if (!alive || !Array.isArray(list)) return;
        setOverrides(list);
        AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(list)).catch(() => {});
      })
      // Silent by design: the bundled catalogue is the source of truth and
      // is already on screen. An override fetch failing is not user-facing.
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [enabled]);

  /* --- the day being rendered ---------------------------------------- *
     A preview pins the date; the live screen tracks the real one and rolls
     over at midnight. Everything below is identical either way, which is the
     whole point — there is no separate "preview path" to drift out of sync. */
  const previewDate = useMemo(
    () => (previewDateKey ? fromYmd(previewDateKey) : null),
    [previewDateKey]
  );
  const activeDate = previewDate || today;

  useEffect(() => {
    if (!enabled || previewDate) return undefined;
    const t = setTimeout(() => setToday(new Date()), msUntilMidnight(today));
    return () => clearTimeout(t);
  }, [enabled, previewDate, today]);

  /* --- resolution ---------------------------------------------------- */
  const calendar = useMemo(() => makeCalendar(overrides), [overrides]);
  const resolved = useMemo(
    () => (enabled ? calendar.forDate(activeDate) : []),
    [enabled, calendar, activeDate]
  );

  // Pinning one occasion of a multi-occasion day is a *filter*, not a
  // reordering — so the pips still show and the scene is exactly the one that
  // will play in that slot.
  const occasions = useMemo(() => {
    if (!previewOccasionKey) return resolved;
    const only = resolved.filter((o) => o.key === previewOccasionKey);
    return only.length ? only : resolved;
  }, [resolved, previewOccasionKey]);

  const dayKey = ymd(activeDate);

  // A new day, or a changed set, always starts from the highest-priority
  // occasion rather than wherever yesterday's rotation happened to stop.
  useEffect(() => {
    setIndex(0);
  }, [dayKey, occasions.length]);

  /* --- rotation ------------------------------------------------------ */
  useEffect(() => {
    if (paused || occasions.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % occasions.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [paused, occasions.length]);

  /* --- once-a-day haptic --------------------------------------------- *
     Skipped in preview: an admin scrubbing through a year would otherwise
     burn the day's one haptic on a date they were only looking at. */
  const hapticFired = useRef(false);
  useEffect(() => {
    if (previewDate || paused || !occasions.length || hapticFired.current || !Haptics) return;
    hapticFired.current = true;
    AsyncStorage.getItem(HAPTIC_DAY_KEY)
      .then((last) => {
        if (last === dayKey) return;
        Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle?.Light);
        return AsyncStorage.setItem(HAPTIC_DAY_KEY, dayKey);
      })
      .catch(() => {});
  }, [previewDate, paused, occasions.length, dayKey]);

  const occasion = occasions.length ? occasions[index % occasions.length] : null;
  const look = useMemo(
    () => (occasion ? themeForOccasion(occasion, isDark) : null),
    [occasion, isDark]
  );

  return {
    /** Every occasion today, highest priority first. */
    occasions,
    /** The one currently on screen. */
    occasion,
    index,
    look,
    date: activeDate,
    isCelebration: occasions.length > 0,
    /** Everything today carries, before any preview pin. */
    allOccasions: resolved,
    isPreview: !!previewDate,
  };
}
