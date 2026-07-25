// Meeting-platform detection + brand metadata. Mirrors the backend copy
// (backend/utils/meetingPlatform.js) so the badge shown while pasting matches
// what the server stores.

// Each platform's real brand colour + a display label + an Ionicons glyph. We use
// a branded badge (colour + name) rather than shipping official logo files.
export const PLATFORM_META = {
  google_meet: { label: 'Google Meet', color: '#00832D', icon: 'videocam' },
  zoom: { label: 'Zoom', color: '#2D8CFF', icon: 'videocam' },
  teams: { label: 'Microsoft Teams', color: '#6264A7', icon: 'people' },
  webex: { label: 'Webex', color: '#00BCEB', icon: 'videocam' },
  other: { label: 'Meeting Link', color: '#6B7280', icon: 'link' },
};

export function detectPlatform(url = '') {
  const u = String(url).toLowerCase().trim();
  if (!u) return 'other';
  if (u.includes('meet.google.com')) return 'google_meet';
  if (u.includes('zoom.us') || u.includes('zoom.com')) return 'zoom';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com') || u.includes('teams.microsoft')) return 'teams';
  if (u.includes('webex.com') || u.includes('.webex.')) return 'webex';
  return 'other';
}

export function platformMeta(platform) {
  return PLATFORM_META[platform] || PLATFORM_META.other;
}

// People paste links WITHOUT a scheme ("meet.google.com/abc"); the OS needs a
// scheme to route the tap into the app/browser, so we prepend https:// when
// missing. Mirrors the backend's `normalizeUrl`.
export function normalizeUrl(url = '') {
  const u = String(url).trim();
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // already has a scheme
  return `https://${u}`;
}

// Accept a normal web link (host.tld/…, scheme optional) OR an app deep-link
// scheme (zoommtg://…, msteams://…). A real link never contains whitespace.
export function isValidMeetingLink(url = '') {
  const raw = String(url).trim();
  if (!raw || /\s/.test(raw)) return false;
  // Non-http app deep link — accept as-is.
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(raw) && !/^https?:/i.test(raw)) return true;
  // Web link (scheme optional): host must contain a dot (host.tld).
  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(normalizeUrl(raw));
}
