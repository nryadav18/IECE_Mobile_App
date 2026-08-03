import * as Location from 'expo-location';
import { Platform } from 'react-native';

/**
 * Precise location acquisition for facial attendance.
 *
 * The naive `getCurrentPositionAsync({})` call this replaces defaults to
 * `Accuracy.Balanced` (~100 m) and will happily hand back a cached, network
 * derived fix — a cell-tower or Wi-Fi guess that can sit kilometres from where
 * the phone actually is. When that lands in a face registration it becomes the
 * permanent geofence anchor, and every later check-in reports an impossible
 * distance even though the person is standing in the right place.
 *
 * So instead of taking the first thing the OS offers we:
 *   1. make sure the device is actually able to produce a fix,
 *   2. nudge Android into high-accuracy (GPS) mode,
 *   3. open a `BestForNavigation` watch and let fixes stream in,
 *   4. throw away stale fixes (cached from an older session/place),
 *   5. keep the tightest fix seen and stop as soon as it is good enough,
 *   6. refuse to return anything too vague to be trusted.
 */

// Stop as soon as a fix is at least this precise — typical of a real GPS lock.
export const TARGET_ACCURACY_M = 25;

// Never hand back a fix vaguer than this. Deliberately the same number the
// server uses to gate a face registration, so the app and the API agree on
// what "precise enough" means and a user can never pass one but fail the other.
// It is loose enough that registering indoors still works, and tight enough
// that a cell-tower guess (which reports hundreds or thousands of metres)
// is always rejected.
export const MAX_ACCURACY_M = 100;

// How long to keep refining before settling for the best fix so far. A cold
// GPS receiver indoors can take well over 15 s to produce its first real fix.
export const MAX_WAIT_MS = 25000;

/**
 * Face registration. The fix captured here becomes the permanent geofence
 * anchor for that school, and its error compounds with the error of every
 * future check-in — so it is held to a tighter standard and given longer to
 * settle. This happens once per school, so asking someone to step outside for
 * a few seconds is a fair price for attendance that then works every day.
 */
export const REGISTRATION_FIX = {
  targetAccuracyM: 20,
  maxAccuracyM: 50,
  maxWaitMs: 35000,
};

/**
 * Daily check-in / check-out. More forgiving and quicker to settle: the anchor
 * is already known to be good, so this fix only has to place the person on the
 * right campus.
 */
export const ATTENDANCE_FIX = {
  targetAccuracyM: TARGET_ACCURACY_M,
  maxAccuracyM: MAX_ACCURACY_M,
  maxWaitMs: MAX_WAIT_MS,
};

// Always let the receiver stream for at least this long. The very first
// callback on Android is usually the last-known cached fix, which can be both
// stale and optimistic about its own accuracy.
const MIN_WAIT_MS = 2500;

// A fix reported with a timestamp older than this is a leftover from an
// earlier session and may describe a completely different place.
const MAX_FIX_AGE_MS = 30000;

/**
 * Error carrying a message that is safe to show the user directly.
 */
export class LocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocationError';
  }
}

/** Thrown when the caller aborts (e.g. the screen was closed). */
export class LocationCancelled extends Error {
  constructor() {
    super('Location lookup cancelled');
    this.name = 'LocationCancelled';
  }
}

const accuracyOf = (fix) => {
  const a = fix?.coords?.accuracy;
  return typeof a === 'number' && a > 0 ? a : Number.POSITIVE_INFINITY;
};

const hasUsableCoords = (fix) => {
  const lat = fix?.coords?.latitude;
  const lng = fix?.coords?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // (0, 0) is what some devices emit when they have no fix at all.
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
  return true;
};

const toResult = (fix) => {
  const acc = accuracyOf(fix);
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracy: Number.isFinite(acc) ? Math.round(acc) : null,
  };
};

/**
 * Make sure the device can actually produce a fix, and give Android users the
 * one-tap system dialog to switch high-accuracy mode on rather than sending
 * them off to hunt through Settings.
 *
 * Throws a user-readable LocationError when location is unusable.
 */
export async function ensureLocationReady() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new LocationError(
      'Location permission is required to mark attendance. Please allow location access in Settings and try again.'
    );
  }

  if (Platform.OS === 'android') {
    // Shows the Google Play services "improve location accuracy" prompt. This
    // both turns location on and switches the device out of battery-saving /
    // device-only mode, so it is tried BEFORE giving up on services below.
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      // User declined. Fall through — they may still have GPS on.
    }
  }

  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new LocationError(
      'Location (GPS) is turned off. Please turn on Location in your device settings and try again.'
    );
  }
}

/**
 * Stream location fixes and resolve with the most precise one we can get.
 *
 * @param {object}       [options]
 * @param {number}       [options.targetAccuracyM] resolve early at/below this accuracy
 * @param {number}       [options.maxAccuracyM]    reject anything vaguer than this
 * @param {number}       [options.maxWaitMs]       give up refining after this long
 * @param {function}     [options.onProgress]      called with ({ accuracy, elapsedMs })
 * @param {AbortSignal}  [options.signal]          abort to tear the watch down early
 * @returns {Promise<{lat: number, lng: number, accuracy: number|null}>}
 * @throws  {LocationError}    with a message suitable for showing the user
 * @throws  {LocationCancelled} when aborted by the caller
 */
export function acquireAccurateLocation({
  targetAccuracyM = TARGET_ACCURACY_M,
  maxAccuracyM = MAX_ACCURACY_M,
  maxWaitMs = MAX_WAIT_MS,
  onProgress,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    let subscription = null;
    let settled = false;
    // Tightest fix that also looks current.
    let best = null;
    // Tightest fix regardless of its timestamp. Only used as a last resort if
    // the staleness filter rejected everything — which happens on devices whose
    // system clock is wrong, where every GPS fix looks decades old. Refusing
    // those outright would lock the user out entirely.
    let bestAny = null;
    let minWaitElapsed = false;
    let hardTimer = null;
    let minTimer = null;

    const cleanup = () => {
      if (hardTimer) clearTimeout(hardTimer);
      if (minTimer) clearTimeout(minTimer);
      hardTimer = null;
      minTimer = null;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (subscription) {
        subscription.remove();
        subscription = null;
      }
    };

    const succeed = (fix) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(toResult(fix));
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    function onAbort() {
      fail(new LocationCancelled());
    }

    // Time is up: take the best fix we managed to collect, provided it is
    // precise enough to be worth trusting.
    const settleWithBest = () => {
      // A very precise fix is a real satellite lock by definition, so accept it
      // even if its timestamp looked wrong.
      const candidate =
        best || (bestAny && accuracyOf(bestAny) <= targetAccuracyM ? bestAny : null);

      if (!candidate) {
        fail(new LocationError(
          'Could not get your location. Please move to an open area with a clear view of the sky, make sure GPS is on, and try again.'
        ));
        return;
      }

      const acc = accuracyOf(candidate);
      if (acc > maxAccuracyM) {
        fail(new LocationError(
          `Your location is only accurate to about ${Math.round(acc)} meters, which is not precise enough to record. Please step outside or near a window, wait a few seconds for GPS to lock, and try again.`
        ));
        return;
      }
      succeed(candidate);
    };

    if (signal) {
      if (signal.aborted) {
        reject(new LocationCancelled());
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    minTimer = setTimeout(() => {
      minWaitElapsed = true;
      // A good fix may already be waiting; don't make the user sit out the
      // rest of the window for it.
      if (best && accuracyOf(best) <= targetAccuracyM) succeed(best);
    }, MIN_WAIT_MS);

    hardTimer = setTimeout(settleWithBest, maxWaitMs);

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        // Report every fix the receiver produces so accuracy can converge.
        timeInterval: 1000,
        distanceInterval: 0,
        mayShowUserSettingsDialog: true,
      },
      (fix) => {
        if (settled || !hasUsableCoords(fix)) return;

        const acc = accuracyOf(fix);
        if (!bestAny || acc < accuracyOf(bestAny)) bestAny = fix;

        // Drop cached fixes from a previous session — they are the main reason
        // a registration ends up anchored kilometres from the real site.
        const age = fix.timestamp ? Date.now() - fix.timestamp : 0;
        if (age > MAX_FIX_AGE_MS) return;

        if (!best || acc < accuracyOf(best)) best = fix;

        if (onProgress) {
          const bestAcc = accuracyOf(best);
          onProgress({
            accuracy: Number.isFinite(bestAcc) ? Math.round(bestAcc) : null,
            elapsedMs: Date.now() - startedAt,
          });
        }

        if (minWaitElapsed && acc <= targetAccuracyM) succeed(fix);
      }
    )
      .then((sub) => {
        subscription = sub;
        // The watch may have been torn down while we were awaiting it.
        if (settled) cleanup();
      })
      .catch(() => {
        fail(new LocationError(
          'Could not read your location. Please make sure GPS is on and try again.'
        ));
      });
  });
}

/**
 * Convenience wrapper: readiness check, then a precise fix.
 */
export async function getAccurateLocation(options) {
  await ensureLocationReady();
  return acquireAccurateLocation(options);
}
