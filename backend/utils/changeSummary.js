// ---------------------------------------------------------------------------
// WHAT ACTUALLY CHANGED
//
// An Approval Log row that says only "Admin edited Ravi Kumar" answers the
// cheapest half of the question. The half that matters — was that a school
// re-assignment, a role change, or a password reset? — used to require asking
// the admin, and after a few days nobody remembers.
//
// So every edit that reaches the log carries a plain sentence describing the
// fields that moved:
//
//   role: Trainer → Team Leader; schools: 2 → 3; password: reset
//
// Rules this module enforces, because they are easy to get wrong once and then
// leak everywhere:
//
//   * SECRETS ARE NEVER VALUES. A password, an OTP or a face embedding is
//     recorded as the fact that it changed, never as what it changed to or
//     from. `secret()` is the only way to record one and it takes no values.
//   * A field that did not change produces nothing. A log full of "name: Ravi
//     Kumar → Ravi Kumar" is a log nobody reads.
//   * Long values are truncated. One pasted paragraph must not make a row
//     unreadable or bloat the collection.
//   * Comparison is by VALUE, not identity — ObjectIds, dates and arrays are
//     normalised first, so a re-saved-but-identical field stays silent.
// ---------------------------------------------------------------------------

const MAX_VALUE = 60;

/** One value, as it should read in a sentence. */
const show = (v) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.length ? `${v.length}` : '(none)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = String(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s;
};

/**
 * Value-identity for comparison. ObjectIds, dates and arrays of either all
 * stringify to something stable so "unchanged" really means unchanged.
 */
const identity = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return String(v.getTime());
  if (Array.isArray(v)) return v.map(identity).join(',');
  if (typeof v === 'object') {
    // A populated ref, a raw ObjectId, or a subdocument — the id is what makes
    // it the same thing.
    if (v._id) return String(v._id);
    if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
      return v.toString();
    }
    return JSON.stringify(v);
  }
  return String(v);
};

/**
 * Collect the changes made during one edit, then render them as a sentence.
 *
 * Usage:
 *   const changes = trackChanges();
 *   changes.field('name', before.name, after.name);
 *   changes.count('schools', before.schoolIds, after.schoolIds);
 *   if (password) changes.secret('password');
 *   changes.summary()  ->  "name: 'Ravi' → 'Ravi Kumar'; schools: 2 → 3; password: reset"
 */
function trackChanges() {
  const parts = [];

  const api = {
    /** A plain before → after field. Silent when the value did not move. */
    field(label, before, after, format = show) {
      if (identity(before) === identity(after)) return api;
      parts.push(`${label}: ${format(before)} → ${format(after)}`);
      return api;
    },

    /** A list where only the size is worth reporting (schools, teams, recipients). */
    count(label, before, after) {
      const a = Array.isArray(before) ? before : [];
      const b = Array.isArray(after) ? after : [];
      if (identity(a) === identity(b)) return api;
      parts.push(`${label}: ${a.length} → ${b.length}`);
      return api;
    },

    /**
     * Something changed whose VALUE must never be written down — a password, an
     * OTP, a face embedding. Takes no values, on purpose: there is no way to
     * accidentally pass one in.
     */
    secret(label, what = 'reset') {
      parts.push(`${label}: ${what}`);
      return api;
    },

    /** A free-form note that is part of the same sentence. */
    note(text) {
      if (text) parts.push(String(text));
      return api;
    },

    /** Did anything actually move? */
    get changed() {
      return parts.length > 0;
    },

    /** The sentence, or a stated fallback when nothing changed. */
    summary(fallback = 'Saved with no changes.') {
      return parts.length ? `Changed ${parts.join('; ')}` : fallback;
    },
  };

  return api;
}

/**
 * The common case in one call: compare two plain objects over a named set of
 * fields.
 *
 * `fields` is `{ key: label }` or `{ key: { label, format } }`.
 */
function diffFields(before = {}, after = {}, fields = {}) {
  const changes = trackChanges();
  Object.entries(fields).forEach(([key, spec]) => {
    const label = typeof spec === 'string' ? spec : spec.label || key;
    const format = (typeof spec === 'object' && spec.format) || show;
    changes.field(label, before?.[key], after?.[key], format);
  });
  return changes;
}

module.exports = { trackChanges, diffFields, show };
