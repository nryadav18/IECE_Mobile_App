/**
 * Turning a date into the occasions that fall on it.
 *
 * Pure, dependency-free and framework-free on purpose: this exact module
 * decides today's header on the phone AND lists a whole year in the admin
 * preview, so those two can never disagree.
 *
 * The server needs the same answer to send a morning wish, but it is deployed
 * on its own and cannot import ES modules out of the app. It runs a deliberate
 * mirror — `backend/utils/occasionCalendar.js` — over the same catalogue,
 * exported to `backend/data/occasions.json` by `backend/scripts/sync-occasions.js`.
 * The date rules below and the ones there must stay in step; both are small,
 * and both are covered by the same spot-check dates.
 */

import { OCCASIONS, VERIFIED_THROUGH } from './occasions';
import { fromYmd, nthWeekdayOf, ymd } from './dates';

export { VERIFIED_THROUGH };

/* ------------------------------------------------------------------ *
 * Easter — computed, never tabulated                                  *
 * ------------------------------------------------------------------ */

/**
 * Easter Sunday, by the anonymous Gregorian Computus.
 *
 * Worth the twenty lines: it is exact for every year, forever, which removes
 * Easter and Good Friday from the part of the catalogue that needs a human to
 * top it up each decade. Spot-checked against 2026 (5 Apr) and 2027 (28 Mar).
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1);
}

/* ------------------------------------------------------------------ *
 * Date rules                                                          *
 * ------------------------------------------------------------------ */

/** Does `occasion` fall on `date`? */
function occursOn(occasion, date) {
  const when = occasion.when;
  if (!when) return false;

  switch (when.type) {
    case 'fixed':
      return date.getMonth() === when.month && date.getDate() === when.day;

    case 'nthWeekday':
      return (
        date.getMonth() === when.month &&
        date.getDay() === when.weekday &&
        date.getDate() === nthWeekdayOf(date.getFullYear(), when.month, when.weekday, when.nth)
      );

    case 'easter': {
      const easter = easterSunday(date.getFullYear());
      const target = new Date(easter);
      target.setDate(target.getDate() + (when.offset || 0));
      return (
        target.getMonth() === date.getMonth() && target.getDate() === date.getDate()
      );
    }

    case 'table': {
      // A year may legitimately carry two occurrences — the Islamic calendar is
      // ~11 days shorter than the Gregorian one, so Eid can fall in both
      // January and December of the same year.
      const entry = when.dates?.[date.getFullYear()];
      if (!entry) return false;
      const key = ymd(date);
      return Array.isArray(entry) ? entry.includes(key) : entry === key;
    }

    case 'exact': // a one-off, from a backend override
      return when.date === ymd(date);

    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Backend overrides                                                   *
 * ------------------------------------------------------------------ */

/**
 * Fold admin-authored overrides into the bundled catalogue.
 *
 * Three things an override can do:
 *   · **mute** a bundled occasion (`muted: true`) — it stops appearing;
 *   · **correct** one, by supplying any subset of its fields. A `date` field
 *     patches just that year's entry in a table, which is how a regionally
 *     different Diwali gets fixed without touching the other nine years;
 *   · **add** one that isn't in the app at all — a Founder's Day, a school
 *     anniversary — either as a one-off `date` or an annual `{month, day}`.
 *
 * Anything malformed is skipped rather than thrown: a bad row in Mongo must
 * never be able to blank the home screen.
 */
export function applyOverrides(catalogue, overrides) {
  if (!Array.isArray(overrides) || overrides.length === 0) return catalogue;

  const byKey = new Map(catalogue.map((o) => [o.key, o]));
  const added = [];

  for (const raw of overrides) {
    if (!raw || typeof raw.key !== 'string' || !raw.key) continue;
    const base = byKey.get(raw.key);

    if (base) {
      if (raw.muted) {
        byKey.delete(raw.key);
        continue;
      }
      const merged = { ...base };
      // Only copy fields the override actually set, so a partial row can't
      // blank a palette or a wish.
      for (const field of ['name', 'wish', 'subtitle', 'person', 'scene', 'palette', 'field',
        'accent', 'ink', 'emblem', 'particles', 'priority', 'tags']) {
        if (raw[field] !== undefined && raw[field] !== null) merged[field] = raw[field];
      }
      // How a supplied date is applied depends on what kind of occasion this
      // is, and getting that wrong is the one way this feature could quietly
      // break itself:
      //
      //   · a MOVING festival gets that single year patched into its table.
      //     Every other year keeps its own date.
      //   · a FIXED occasion is *moved*, still annually. Writing a one-off here
      //     would turn Independence Day into a date that happens once and never
      //     again — so the month and day are lifted out and the rule stays
      //     `fixed`. Correcting a date must never cost an occasion its
      //     recurrence.
      //   · anything else (a rule-based or custom day) becomes a one-off.
      if (raw.date && base.when?.type === 'table') {
        const year = Number(raw.date.slice(0, 4));
        merged.when = { type: 'table', dates: { ...base.when.dates, [year]: raw.date } };
        merged.needsDates = false;
      } else if (raw.date && base.when?.type === 'fixed') {
        const moved = fromYmd(raw.date);
        if (moved) merged.when = { type: 'fixed', month: moved.getMonth(), day: moved.getDate() };
      } else if (raw.date) {
        merged.when = { type: 'exact', date: raw.date };
      } else if (raw.recurring) {
        merged.when = { type: 'fixed', month: raw.recurring.month, day: raw.recurring.day };
      }
      merged.overridden = true;
      byKey.set(raw.key, merged);
      continue;
    }

    // A brand-new occasion. It needs a date rule and a wish to be worth showing.
    const when = raw.date
      ? { type: 'exact', date: raw.date }
      : raw.recurring
        ? { type: 'fixed', month: raw.recurring.month, day: raw.recurring.day }
        : null;
    if (!when || raw.muted) continue;

    added.push({
      key: raw.key,
      name: raw.name || raw.key,
      wish: raw.wish || raw.name || 'Celebrating today',
      subtitle: raw.subtitle,
      person: raw.person,
      when,
      scene: raw.scene || 'confetti',
      palette: Array.isArray(raw.palette) && raw.palette.length ? raw.palette : ['#E23744', '#FF7A85', '#2B0208'],
      field: raw.field,
      accent: raw.accent,
      ink: raw.ink,
      emblem: raw.emblem || 'sparkles-outline',
      particles: raw.particles || 'confetti',
      priority: Number.isFinite(raw.priority) ? raw.priority : 50,
      tags: Array.isArray(raw.tags) ? raw.tags : ['company'],
      custom: true,
    });
  }

  // Preserve catalogue order for bundled entries; custom ones sort in by
  // priority like everything else.
  return [...catalogue.filter((o) => byKey.has(o.key)).map((o) => byKey.get(o.key)), ...added];
}

/* ------------------------------------------------------------------ *
 * The calendar                                                        *
 * ------------------------------------------------------------------ */

let warnedPastCoverage = false;

/**
 * Build a calendar over the catalogue (plus any overrides).
 *
 * Memoised per day, so the admin preview can scrub through a year — or Home
 * can re-render fifty times while scrolling — without ever re-walking the
 * catalogue. Create one per set of overrides and hold onto it; that's what
 * `useOccasions` does.
 */
export function makeCalendar(overrides) {
  const catalogue = applyOverrides(OCCASIONS, overrides);
  const dayCache = new Map();
  const yearCache = new Map();

  function forDate(date = new Date()) {
    const key = ymd(date);
    const hit = dayCache.get(key);
    if (hit) return hit;

    if (__DEV__ && !warnedPastCoverage && date.getFullYear() > VERIFIED_THROUGH) {
      warnedPastCoverage = true;
      console.warn(
        `[celebrations] The moving-festival table only runs to ${VERIFIED_THROUGH}; ` +
        `${date.getFullYear()} will show fixed-date occasions only. ` +
        'Top up frontend/src/celebrations/lunar.js, or add dates via /api/occasions.'
      );
    }

    // Sorted by priority, with catalogue order as a stable tiebreak so a day
    // always resolves identically — which matters for the admin preview.
    const found = catalogue
      .map((occasion, index) => ({ occasion, index }))
      .filter(({ occasion }) => occursOn(occasion, date))
      .sort((a, b) =>
        (b.occasion.priority || 0) - (a.occasion.priority || 0) || a.index - b.index
      )
      .map(({ occasion }) => occasion);

    dayCache.set(key, found);
    return found;
  }

  /**
   * Every celebrated day in a year, in date order — the admin listing.
   * Walking the year through `forDate` (rather than inverting each date rule)
   * guarantees the list shows exactly what Home would show.
   */
  function forYear(year) {
    const hit = yearCache.get(year);
    if (hit) return hit;

    const out = [];
    const cursor = new Date(year, 0, 1);
    while (cursor.getFullYear() === year) {
      const occasions = forDate(cursor);
      if (occasions.length) out.push({ date: new Date(cursor), key: ymd(cursor), occasions });
      cursor.setDate(cursor.getDate() + 1);
    }
    yearCache.set(year, out);
    return out;
  }

  /** Occasions the catalogue knows about but has no date for in `year`. */
  function missingDatesFor(year) {
    return catalogue.filter(
      (o) => o.needsDates && o.when?.type === 'table' && !o.when.dates?.[year]
    );
  }

  return { catalogue, forDate, forYear, missingDatesFor };
}

/** Convenience for callers with no overrides (the push-notification job). */
export const defaultCalendar = makeCalendar(null);
export const occasionsFor = (date) => defaultCalendar.forDate(date);
