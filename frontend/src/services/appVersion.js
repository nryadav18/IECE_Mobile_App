/**
 * "Is this build current?"
 *
 * Asked at every launch and every time the app comes back from the background.
 * The answer comes from `GET /api/app-version`, which is public precisely so
 * that a build too old to authenticate can still be told to update.
 */

import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import api from './api';

/**
 * `expo-application` reports the version of the binary that is actually
 * installed, which is the honest answer. It is an optional require for the
 * same reason `expo-haptics` is: a JS bundle can reach a device whose native
 * build predates the module, and a missing native module must not be able to
 * break the launch path.
 *
 * The fallback, `expo-constants`, reads the version baked in from app.json at
 * build time — correct for store builds, which is the only case that matters
 * here.
 */
let Application = null;
try {
  Application = require('expo-application');
} catch {
  Application = null;
}

/** The version of the app the user is holding. */
export function installedVersion() {
  return (
    Application?.nativeApplicationVersion ||
    Constants?.expoConfig?.version ||
    Constants?.manifest?.version ||
    null
  );
}

/**
 * Dotted version comparison — mirrors `backend/utils/versionCompare.js`.
 *
 * The server already decides whether an update is available; this exists so the
 * client can *refuse* a prompt that doesn't add up. If a wrong number is ever
 * saved in the admin screen, the worst case should be "nothing happens", not
 * "the entire company is sent to the store to install what they already have".
 *
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? '')
      .split('.')
      .map((seg) => parseInt(String(seg).replace(/[^0-9].*$/, ''), 10) || 0);

  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);

  for (let i = 0; i < len; i++) {
    const x = av[i] || 0;
    const y = bv[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Ask the server. Returns null when there is nothing to say — including on any
 * error, because a failed check must never surface to the user or block them.
 */
export async function checkForUpdate() {
  const version = installedVersion();
  const platform = Platform.OS; // 'android' | 'ios'
  if (platform !== 'android' && platform !== 'ios') return null;

  try {
    const res = await api.get('/app-version', { params: { platform, version } });
    const data = res?.data?.data;
    if (!data?.updateAvailable || !data.latestVersion) return null;

    // Independent sanity check — see compareVersions above.
    if (version && compareVersions(version, data.latestVersion) >= 0) return null;

    return {
      current: version,
      latest: data.latestVersion,
      required: !!data.required,
      storeUrl: data.storeUrl || null,
      releaseNotes: (data.releaseNotes || '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Open the store listing.
 *
 * Tries the native scheme first (`market://` on Android, `itms-apps://` on
 * iOS) because those open the store app directly on the right page. If the
 * store app isn't installed — an Android device without Play services, a
 * simulator — it falls back to the https URL, which the browser handles.
 */
export async function openStore(httpsUrl) {
  if (!httpsUrl) return false;

  const native =
    Platform.OS === 'android'
      ? httpsUrl.replace(/^https?:\/\/play\.google\.com\/store\/apps\/details/, 'market://details')
      : httpsUrl.replace(/^https?:\/\//, 'itms-apps://');

  try {
    if (native !== httpsUrl && (await Linking.canOpenURL(native))) {
      await Linking.openURL(native);
      return true;
    }
  } catch {
    // fall through to https
  }

  try {
    await Linking.openURL(httpsUrl);
    return true;
  } catch {
    return false;
  }
}
