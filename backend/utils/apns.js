const apn = require('@parse/node-apn');

/**
 * Direct Apple Push Notification service (APNs) delivery.
 *
 * iOS devices hand the app a raw APNs device token (a hex string), NOT an FCM
 * registration token. The Firebase Admin SDK rejects those with
 * `messaging/invalid-argument`, so iOS pushes are sent here instead — straight
 * to APNs over HTTP/2 using an APNs Auth Key (.p8).
 *
 * Credentials are resolved in this order (never GOOGLE_* / generic vars):
 *   1. APNS_KEY        — full .p8 contents as a string (best for prod hosts)
 *   2. APNS_KEY_PATH   — path to the .p8 file
 *   3. ./secrets/apnsKey.p8 — local fallback (gitignored)
 * plus APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRODUCTION.
 *
 * Sets an availability flag so the server still boots without APNs config
 * (iOS pushes then no-op with a clear log) instead of crashing.
 */
let initialized = false;
let available = false;
let provider = null;
let bundleId = null;

const initApns = () => {
  if (initialized) return available;
  initialized = true;

  try {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    bundleId = process.env.APNS_BUNDLE_ID || 'com.ieceaccts.iece';

    // `key` accepts either the .p8 contents or a path to the file.
    let key;
    if (process.env.APNS_KEY) {
      key = process.env.APNS_KEY.replace(/\\n/g, '\n'); // tolerate escaped newlines from env
    } else if (process.env.APNS_KEY_PATH) {
      key = process.env.APNS_KEY_PATH;
    } else {
      key = require('path').join(__dirname, '..', 'secrets', 'apnsKey.p8');
    }

    if (!keyId || !teamId) {
      throw new Error('APNS_KEY_ID and APNS_TEAM_ID are required');
    }

    // Production true => api.push.apple.com; false => api.sandbox.push.apple.com.
    // Release/TestFlight builds use production; a plain `expo run:ios` debug
    // build uses sandbox. Defaults to production.
    const production = String(process.env.APNS_PRODUCTION ?? 'true').toLowerCase() !== 'false';

    provider = new apn.Provider({
      token: { key, keyId, teamId },
      production,
    });

    available = true;
    console.log(
      `APNs initialized for bundle ${bundleId} (${production ? 'production' : 'sandbox'})`
    );
  } catch (err) {
    available = false;
    console.error(
      'APNs NOT initialized — iOS push notifications disabled. Reason:',
      err.message
    );
  }

  return available;
};

// APNs reasons that mean the token is permanently dead and should be dropped.
const DEAD_APNS_REASONS = new Set(['Unregistered', 'BadDeviceToken']);

/**
 * Send a push to one or more APNs device tokens.
 * @param {string[]} tokens - APNs (hex) device tokens
 * @returns {Promise<{successCount:number, failureCount:number, deadTokens:string[]}>}
 */
const sendApnsNotification = async (tokens, title, body, data = {}) => {
  if (!available || !provider) {
    console.error('iOS push skipped: APNs is not initialized.');
    return { successCount: 0, failureCount: tokens.length, deadTokens: [] };
  }

  const note = new apn.Notification();
  note.topic = bundleId; // required — the app bundle id
  note.alert = { title, body };
  note.sound = 'default';
  note.badge = 1;
  note.pushType = 'alert';
  // Mirror the FCM data payload (values coerced to strings for consistency).
  const payload = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) payload[k] = String(v);
  });
  note.payload = payload;

  const result = await provider.send(note, tokens);

  const deadTokens = [];
  result.failed.forEach((f) => {
    const reason = f.response?.reason || f.error?.message || `status ${f.status}`;
    console.error(`Push failed for ${f.device}: apns/${reason}`);
    if (DEAD_APNS_REASONS.has(f.response?.reason) || String(f.status) === '410') {
      deadTokens.push(f.device);
    }
  });
  result.sent.forEach((s) => console.log(`Push delivered to ${s.device} (apns)`));

  return {
    successCount: result.sent.length,
    failureCount: result.failed.length,
    deadTokens,
  };
};

module.exports = {
  initApns,
  isApnsAvailable: () => available,
  sendApnsNotification,
};
