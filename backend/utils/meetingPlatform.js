// Detect which meeting platform a pasted link belongs to, from its URL. Kept in
// sync with the frontend copy (frontend/src/utils/meetingPlatform.js) so the
// badge shown while typing matches what the server stores.

const PLATFORMS = ['google_meet', 'zoom', 'teams', 'webex', 'other'];

function detectPlatform(url = '') {
  const u = String(url).toLowerCase().trim();
  if (!u) return 'other';
  if (u.includes('meet.google.com')) return 'google_meet';
  if (u.includes('zoom.us') || u.includes('zoom.com')) return 'zoom';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com') || u.includes('teams.microsoft')) return 'teams';
  if (u.includes('webex.com') || u.includes('.webex.')) return 'webex';
  return 'other';
}

// Normalize a pasted link so it can actually be opened. People paste links
// WITHOUT a scheme ("meet.google.com/abc", "zoom.us/j/123") — but the OS needs a
// scheme to route the tap into the app/browser, so we prepend https:// when one
// is missing. Existing schemes (https://, http://, zoommtg:, msteams:) are kept.
function normalizeUrl(url = '') {
  const u = String(url).trim();
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // already has a scheme (http:, zoommtg:, …)
  return `https://${u}`;
}

// Accept a normal web link (host.tld/…, scheme optional) OR an app deep-link
// scheme (zoommtg://…, msteams://…). A real link never contains whitespace.
function isValidMeetingLink(url = '') {
  const raw = String(url).trim();
  if (!raw || /\s/.test(raw)) return false;
  // Non-http app deep link — accept as-is.
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(raw) && !/^https?:/i.test(raw)) return true;
  // Web link (scheme optional): host must contain a dot (host.tld).
  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(normalizeUrl(raw));
}

module.exports = { PLATFORMS, detectPlatform, normalizeUrl, isValidMeetingLink };
