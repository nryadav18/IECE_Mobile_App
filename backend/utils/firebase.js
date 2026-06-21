const { initializeApp, cert, getApps } = require('firebase-admin/app');

/**
 * Initialize the Firebase Admin SDK exactly once.
 *
 * Credentials are resolved in this order (deliberately NOT using the generic
 * GOOGLE_APPLICATION_CREDENTIALS, which is often set system-wide for an
 * unrelated Google Cloud project and would silently shadow our key):
 *   1. FIREBASE_SERVICE_ACCOUNT       — full service-account JSON as a string (best for prod hosts)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH  — path to a service-account JSON file
 *   3. ./secrets/serviceAccountKey.json — local fallback (gitignored)
 *
 * Sets an availability flag so the server still boots even without credentials
 * (pushes then no-op with a clear log) instead of crashing.
 */
let initialized = false;
let available = false;

const initFirebase = () => {
  if (initialized) return available;
  initialized = true;

  // Avoid double-initialization if another module already created the app.
  if (getApps().length > 0) {
    available = true;
    return available;
  }

  try {
    let credentialJson;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credentialJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      credentialJson = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    } else {
      // Local dev fallback — gitignored file.
      credentialJson = require('../secrets/serviceAccountKey.json');
    }

    initializeApp({ credential: cert(credentialJson) });

    available = true;
    console.log(`Firebase Admin initialized for project: ${credentialJson.project_id}`);
  } catch (err) {
    available = false;
    console.error(
      'Firebase Admin NOT initialized — push notifications disabled. Reason:',
      err.message
    );
  }

  return available;
};

module.exports = { initFirebase, isFirebaseAvailable: () => available };
