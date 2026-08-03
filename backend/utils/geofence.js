/**
 * Geofence rules for facial attendance.
 *
 * There are two radii on purpose:
 *
 *  - DISPLAY_RADIUS_M is the only number the app, the error messages and the
 *    admin maps are ever allowed to show. It is what staff believe the rule is.
 *  - ENFORCED_RADIUS_M is what the server actually checks. It is deliberately
 *    wider so that ordinary phone-GPS drift (indoors, thick walls, poor sky
 *    view, Wi-Fi-derived fixes) does not lock an honest person out of their
 *    own campus. It must never be surfaced to end users.
 *
 * Keep every geofence decision going through this module so the two numbers
 * can never drift apart across controllers.
 */

// Public-facing radius — safe to show anywhere.
const DISPLAY_RADIUS_M = 50;

// Real radius applied by the server. INTERNAL — do not put this in any
// API response, log line the client can read, or UI string.
const ENFORCED_RADIUS_M = 150;

// A registration anchors every future check-in for that school, so a sloppy
// fix here poisons attendance forever. Reject anchors whose reported GPS
// uncertainty is worse than this. Mirrors REGISTRATION_FIX.maxAccuracyM in
// the app — keep the two in step.
const MAX_REGISTRATION_ACCURACY_M = 50;

// A check-in fix this uncertain tells us nothing useful, so it is refused
// rather than silently accepted. Looser than registration because the anchor
// is already trusted at that point. Mirrors ATTENDANCE_FIX.maxAccuracyM.
//
// The two together are what keep the enforced radius honest: in the worst
// case the anchor is off by 50 m and the check-in by 100 m in the opposite
// direction, which still lands inside ENFORCED_RADIUS_M.
const MAX_VERIFICATION_ACCURACY_M = 100;

/**
 * Great-circle distance between two WGS-84 points, in metres (Haversine).
 */
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in m
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * True when a measured distance falls inside the real (hidden) radius.
 */
function isWithinGeofence(distanceM) {
  return Number.isFinite(distanceM) && distanceM <= ENFORCED_RADIUS_M;
}

/**
 * Parse a client-supplied coordinate pair and reject anything that is not a
 * usable fix. A missing / NaN / out-of-range value, or the (0, 0) null island
 * that some devices emit when they have no fix at all, is treated as "no
 * location" instead of being trusted as a real place.
 *
 * @returns {{ ok: true, lat: number, lng: number } | { ok: false, message: string }}
 */
function parseCoordinates(rawLat, rawLng) {
  const lat = parseFloat(rawLat);
  const lng = parseFloat(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: 'Location is required. Please turn on GPS and try again.' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, message: 'Your device reported an invalid location. Please turn GPS off and on, then try again.' };
  }
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) {
    return { ok: false, message: 'Your device could not determine where you are. Please move to an open area and try again.' };
  }

  return { ok: true, lat, lng };
}

/**
 * Parse the reported GPS uncertainty (in metres) that the app sends alongside
 * the coordinates. Older app builds do not send it, so `null` means "unknown"
 * and is allowed through rather than blocking those users.
 *
 * @returns {{ ok: true, accuracy: number|null } | { ok: false, message: string }}
 */
function parseAccuracy(rawAccuracy, maxAccuracyM) {
  if (rawAccuracy === undefined || rawAccuracy === null || rawAccuracy === '') {
    return { ok: true, accuracy: null };
  }

  const accuracy = parseFloat(rawAccuracy);
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return { ok: true, accuracy: null };
  }

  if (accuracy > maxAccuracyM) {
    return {
      ok: false,
      message: `Your location is only accurate to about ${Math.round(accuracy)} meters right now, which is too rough to record. Please step outside or near a window, wait a few seconds for the GPS to lock, and try again.`,
    };
  }

  return { ok: true, accuracy };
}

module.exports = {
  DISPLAY_RADIUS_M,
  ENFORCED_RADIUS_M,
  MAX_REGISTRATION_ACCURACY_M,
  MAX_VERIFICATION_ACCURACY_M,
  getDistanceFromLatLonInM,
  isWithinGeofence,
  parseCoordinates,
  parseAccuracy,
};
