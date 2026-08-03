const fs = require('fs');
const path = require('path');

/**
 * The released version, read straight out of the app's own `app.json`.
 *
 * There is no admin screen and no database row for this any more. The number
 * in `frontend/app.json` is the version you build and ship, so it is the only
 * number that can't drift out of step with reality — bump it, redeploy, done.
 *
 * ── The one rule ─────────────────────────────────────────────────────────
 * **Bump `app.json` only when the build is live in the stores**, not when you
 * start the build. This file is picked up automatically within a minute, and
 * an update is mandatory — so raising it while the release is still in review
 * would block everyone from an app they cannot yet install. Build from a
 * branch, or bump it as the last step of the release.
 *
 * (iOS is protected from this by itself: the controller never asks for more
 * than Apple's live listing actually has. Android has no such API, so on
 * Android this rule is the whole safety net.)
 *
 * ── When it can't find the file ──────────────────────────────────────────
 * Returns null, and the check goes quiet — no prompt, no gate. That matters
 * if the backend is ever deployed on its own without the frontend folder
 * beside it: the failure mode is "nobody is nagged", never "everybody is
 * locked out". `APP_VERSION` in the environment is the explicit override for
 * that case.
 */

/** Where to look, in order. First hit wins. */
const CANDIDATES = [
  process.env.APP_JSON_PATH,
  path.resolve(__dirname, '../../frontend/app.json'),
  path.resolve(__dirname, '../frontend/app.json'),
  path.resolve(process.cwd(), '../frontend/app.json'),
  path.resolve(process.cwd(), 'frontend/app.json'),
].filter(Boolean);

// Re-read only when the file's mtime changes, and at most once a minute.
// Every app launch calls this, so it must not stat-and-parse on every request.
const RECHECK_MS = 60 * 1000;
let cache = { checkedAt: 0, mtimeMs: 0, version: null, source: null };

function locate() {
  for (const candidate of CANDIDATES) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Unreadable path — try the next one.
    }
  }
  return null;
}

/**
 * @returns {{ version: string|null, source: string|null }}
 */
function readReleaseVersion() {
  // Explicit override always wins, and needs no file at all.
  if (process.env.APP_VERSION) {
    return { version: String(process.env.APP_VERSION).trim(), source: 'APP_VERSION env' };
  }

  const now = Date.now();
  if (now - cache.checkedAt < RECHECK_MS) {
    return { version: cache.version, source: cache.source };
  }

  const file = locate();
  if (!file) {
    cache = { checkedAt: now, mtimeMs: 0, version: null, source: null };
    return { version: null, source: null };
  }

  try {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs === cache.mtimeMs && cache.version) {
      cache.checkedAt = now;
      return { version: cache.version, source: cache.source };
    }

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const version = parsed?.expo?.version || parsed?.version || null;

    cache = {
      checkedAt: now,
      mtimeMs,
      version: version ? String(version).trim() : null,
      source: file,
    };
    if (cache.version) {
      console.log(`[app-version] Release version ${cache.version} (from ${path.basename(file)})`);
    }
    return { version: cache.version, source: cache.source };
  } catch (err) {
    console.error('[app-version] Could not read app.json:', err.message);
    // Keep the last good value rather than dropping to null mid-flight.
    return { version: cache.version, source: cache.source };
  }
}

module.exports = { readReleaseVersion };
