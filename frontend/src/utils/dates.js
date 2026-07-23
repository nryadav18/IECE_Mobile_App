// Small date helpers for the substitution feature.

// 'YYYY-MM-DD' in local time (safe for API date fields / date-only compares).
export const toYMD = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// e.g. "23 Jul 2026" for display.
export const prettyDate = (d) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Inclusive whole-day count between two dates.
export const dayCountInclusive = (from, to) => {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};
