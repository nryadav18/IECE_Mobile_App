// ---------------------------------------------------------------------------
// THE SEVEN PLACES A CLOUD URL CAN LIVE.
//
// This list is the whole scope of the migration. Every script in this folder —
// audit, copy, verify, flip — derives what it touches from here and nowhere
// else, so there is exactly one definition to keep correct and no chance of the
// copy job and the flip job disagreeing about what exists.
//
// It is deliberately expressed as data rather than as queries. A folder in
// Cloudinary does NOT map to one collection (POST /upload routes purely by MIME
// type, so `iece_images` feeds banners, activity photos and leave proofs
// alike), which means the only trustworthy statement of scope is "these fields,
// in this database" — read outward from Mongo, never inward from a bucket
// listing.
//
// If a field is ever added that stores a URL, adding it here is the entire
// change required.
// ---------------------------------------------------------------------------

/**
 * `kind` tells the extractor how to read the field off a document:
 *   scalar        a plain string at `path`
 *   array         an array of strings at `path`
 *   subdocArray   an array of subdocuments; `path` is "<array>.<field>"
 */
const URL_FIELDS = [
  {
    model: 'Activity',
    path: 'mediaUrls',
    kind: 'array',
    holds: 'Activity photos and videos',
    folders: ['iece_images', 'iece_uploads'],
    bucket: 'public',
  },
  {
    model: 'Media',
    path: 'imageUrl',
    kind: 'scalar',
    holds: 'Home banners',
    folders: ['iece_images'],
    bucket: 'public',
  },
  {
    model: 'School',
    path: 'mouPdfUrl',
    kind: 'scalar',
    holds: 'MOU PDF / Word document',
    folders: ['iece_mous'],
    bucket: 'public',
  },
  {
    model: 'User',
    path: 'timetablePdfUrl',
    kind: 'scalar',
    holds: 'Timetable PDF',
    folders: ['iece_mous'],
    bucket: 'public',
  },
  {
    // Misleadingly named — it holds a VIDEO url, inherited from an earlier
    // version of facial registration. See utils/faceVideo.js.
    model: 'User',
    path: 'registrationPhotoUrl',
    kind: 'scalar',
    holds: 'Legacy face registration video',
    folders: ['facial_registrations'],
    bucket: 'private',
  },
  {
    model: 'User',
    path: 'faceRegistrations.registrationPhotoUrl',
    kind: 'subdocArray',
    holds: 'Per-school face registration video',
    folders: ['facial_registrations_v2'],
    bucket: 'private',
  },
  {
    model: 'LeaveRequest',
    path: 'proofs',
    kind: 'array',
    holds: 'Leave proof photos and PDFs',
    folders: ['iece_images', 'iece_mous'],
    bucket: 'public',
  },
];

/**
 * Pull every URL a single document contributes to one field.
 *
 * Returns `{ value, index }` pairs rather than bare strings: the index is what
 * lets the flip script rewrite element 3 of `mediaUrls` without disturbing the
 * other four, and what lets the audit report say precisely where a dangling
 * reference sits.
 */
function readField(doc, spec) {
  const out = [];
  const push = (value, index) => {
    if (typeof value === 'string' && value.trim()) out.push({ value: value.trim(), index });
  };

  if (spec.kind === 'scalar') {
    push(doc[spec.path], null);
    return out;
  }

  if (spec.kind === 'array') {
    const arr = doc[spec.path];
    if (Array.isArray(arr)) arr.forEach((v, i) => push(v, i));
    return out;
  }

  if (spec.kind === 'subdocArray') {
    const [arrayName, leaf] = spec.path.split('.');
    const arr = doc[arrayName];
    if (Array.isArray(arr)) arr.forEach((sub, i) => push(sub && sub[leaf], i));
    return out;
  }

  return out;
}

/**
 * The projection to hand Mongo for one field spec — never the whole document.
 *
 * A `users` collection carries face embeddings (arrays of hundreds of floats)
 * and school history on every record. Reading all of it to look at one string
 * field turns a quick audit into a multi-gigabyte download.
 */
function projectionFor(spec) {
  const key = spec.kind === 'subdocArray' ? spec.path.split('.')[0] : spec.path;
  return { [key]: 1 };
}

/** A Mongo filter that skips documents which cannot contribute a URL. */
function filterFor(spec) {
  const key = spec.kind === 'subdocArray' ? spec.path.split('.')[0] : spec.path;
  if (spec.kind === 'scalar') return { [key]: { $type: 'string', $ne: '' } };
  return { [key]: { $exists: true, $ne: [] } };
}

/** Human label used throughout the reports, e.g. "User.faceRegistrations[].registrationPhotoUrl". */
function label(spec) {
  if (spec.kind === 'array') return `${spec.model}.${spec.path}[]`;
  if (spec.kind === 'subdocArray') {
    const [arrayName, leaf] = spec.path.split('.');
    return `${spec.model}.${arrayName}[].${leaf}`;
  }
  return `${spec.model}.${spec.path}`;
}

module.exports = { URL_FIELDS, readField, projectionFor, filterFor, label };
