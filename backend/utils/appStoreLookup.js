const axios = require('axios');

/**
 * What version is live on the App Store right now?
 *
 * Apple publishes this: the iTunes Lookup endpoint takes a bundle id and
 * returns the live listing, including `version`, `trackViewUrl` and the
 * "What's New" text. No key, no auth, no quota worth worrying about. So iOS
 * update detection is fully automatic — nobody has to remember to tell the
 * backend that a release went out.
 *
 * ── Google Play has no equivalent ────────────────────────────────────────
 * There is no public endpoint that reports an Android app's live version.
 * The three things people try:
 *
 *   · scraping the Play Store page — the markup changes without notice, and
 *     apps shipped as an App Bundle usually render "Varies with device"
 *     instead of a version at all;
 *   · the Play Developer API — real, but needs a Google Cloud service account
 *     and OAuth set up against the Play Console;
 *   · Play In-App Updates (Play Core) — the *correct* answer, where the Play
 *     Store tells the app directly. It is a native API, so it needs a module
 *     and a rebuild.
 *
 * Rather than ship something that silently stops working, Android's latest
 * version is set explicitly in the admin portal — one field, at release time.
 * That is exact, immediate, and can also be pointed at a *minimum* version to
 * force an upgrade, which none of the automatic options give you.
 */

const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.ieceaccts.iece';
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.iece_accts.iece';

const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const LOOKUP_COUNTRY = process.env.IOS_STORE_COUNTRY || 'IN';

/** Public store URLs, used as the fallback when nothing is configured. */
const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const APP_STORE_SEARCH_URL = `https://apps.apple.com/${LOOKUP_COUNTRY.toLowerCase()}/app/id`;

// One shared cache. Every app launch hits this endpoint, so without it a busy
// morning would mean thousands of identical calls to Apple.
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache = { at: 0, data: null };

/**
 * The live App Store listing, or null if it can't be reached.
 * Never throws — a lookup failure must degrade to "no update known", never to
 * a failed launch check.
 */
async function fetchIosStoreInfo({ force = false } = {}) {
  const fresh = Date.now() - cache.at < TTL_MS;
  if (!force && fresh && cache.data) return cache.data;

  try {
    const res = await axios.get(LOOKUP_URL, {
      params: { bundleId: IOS_BUNDLE_ID, country: LOOKUP_COUNTRY },
      timeout: 6000,
    });

    const entry = res.data?.results?.[0];
    if (!entry?.version) {
      // A valid response with no results means the app isn't on that
      // storefront yet. Cache the miss so we don't retry on every launch.
      cache = { at: Date.now(), data: null };
      return null;
    }

    const data = {
      version: String(entry.version),
      storeUrl: entry.trackViewUrl || `${APP_STORE_SEARCH_URL}${entry.trackId}`,
      releaseNotes: entry.releaseNotes || '',
      trackId: entry.trackId || null,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error('[app-version] App Store lookup failed:', err.message);
    // Keep whatever was cached rather than dropping to null — a stale-but-real
    // version is far more useful than none.
    return cache.data;
  }
}

module.exports = {
  fetchIosStoreInfo,
  IOS_BUNDLE_ID,
  ANDROID_PACKAGE,
  PLAY_URL,
};
