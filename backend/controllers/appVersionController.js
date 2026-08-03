const { compareVersions, isOlderThan } = require('../utils/versionCompare');
const { fetchIosStoreInfo, PLAY_URL } = require('../utils/appStoreLookup');
const { readReleaseVersion } = require('../utils/appVersionSource');

/**
 * The launch-time version check — fully automatic.
 *
 * The released version comes from `frontend/app.json`, the same field that is
 * baked into the builds you submit. Nothing to configure, no admin screen, no
 * database row: bump the version, redeploy, and every older install is gated
 * on its next launch.
 *
 * Deliberately public — no `protect`. The gate has to be able to appear on the
 * login screen: a build too old to authenticate is exactly the one that needs
 * updating, and requiring a valid token to discover that would be circular.
 *
 * ── Two safety properties, both load-bearing ─────────────────────────────
 *
 * 1. **It fails open.** No app.json, no version, an unparseable string, a
 *    thrown error — every one of those answers "no update". This gate blocks
 *    the whole app for every user at once, so a fault must never be able to
 *    raise it. A block is only ever raised on a positive, verified answer.
 *
 * 2. **iOS never asks for more than Apple has.** app.json is bumped when you
 *    build; Apple's listing changes when the release actually goes live, which
 *    can be days later. Taking the LOWER of the two means iOS users are never
 *    told to install something that isn't downloadable yet. Google publishes
 *    no equivalent, so on Android the protection is procedural: only bump
 *    app.json once the Play release is live.
 */

/** Global kill switch, for when something has gone wrong and everyone is stuck. */
const DISABLED = String(process.env.UPDATE_GATE_DISABLED || '').toLowerCase() === 'true';

/**
 * @desc    Is the caller's build current?
 * @route   GET /api/app-version?platform=android&version=4.0.0
 * @access  Public
 */
exports.checkAppVersion = async (req, res) => {
  const platform = String(req.query.platform || '').toLowerCase();
  const current = String(req.query.version || '').trim();

  // One response shape, always, so the client never special-cases anything.
  const quiet = {
    success: true,
    data: {
      updateAvailable: false,
      required: false,
      currentVersion: current || null,
      latestVersion: null,
      storeUrl: platform === 'android' ? PLAY_URL : null,
      releaseNotes: null,
      platform: platform || null,
    },
  };

  if (DISABLED) return res.json(quiet);
  if (platform !== 'android' && platform !== 'ios') return res.json(quiet);

  try {
    const { version: released } = readReleaseVersion();
    // Nothing to compare against — stay quiet rather than guess.
    if (!released) return res.json(quiet);

    let latestVersion = released;
    let storeUrl = platform === 'android' ? PLAY_URL : null;
    let releaseNotes = null;

    if (platform === 'ios') {
      const store = await fetchIosStoreInfo();
      if (store?.version) {
        storeUrl = store.storeUrl;
        releaseNotes = store.releaseNotes || null;
        // Never ask for more than the App Store actually has. See note above.
        if (compareVersions(store.version, released) < 0) latestVersion = store.version;
      } else {
        // Apple returned nothing — we cannot confirm anything is downloadable,
        // so we say nothing rather than send people to an empty listing.
        return res.json(quiet);
      }
    }

    // A build that reports no version can't be compared, and must not be
    // gated on a guess.
    if (!current) {
      return res.json({ ...quiet, data: { ...quiet.data, latestVersion, storeUrl, releaseNotes } });
    }

    // Every available update is mandatory — nobody uses IECE on an old build.
    const behind = isOlderThan(current, latestVersion);

    res.json({
      success: true,
      data: {
        updateAvailable: behind,
        required: behind,
        strict: true,
        currentVersion: current,
        latestVersion,
        storeUrl,
        releaseNotes,
        platform,
      },
    });
  } catch (err) {
    console.error('checkAppVersion:', err.message);
    // Never let this fail a launch. Silence is the safe answer.
    res.json(quiet);
  }
};
