const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// WHAT A FILE IS CALLED IN R2.
//
// The layout mirrors Cloudinary exactly — same folder names, same
// `<timestamp>-<name>` shape — for one reason: it makes the old URL and the new
// URL derivable from each other. That is what lets the migration verify itself
// mechanically, and what lets a rollback be a string transformation rather than
// a lookup table nobody can check by eye.
//
// Two rules here are load-bearing rather than cosmetic:
//
//   THE EXTENSION IS PART OF THE KEY. Cloudinary kept the format outside the
//   public_id and appended it on delivery. R2 does no such thing — the key is
//   the whole name. A key without an extension serves a file that browsers and
//   expo-video have to guess at.
//
//   A VIDEO AND ITS POSTER SHARE A BASE. Installed app builds derive a video
//   thumbnail by replacing `.mp4` with `.jpg` and asking for it. Cloudinary
//   generated that frame on demand; R2 will 404 it. So the poster is stored at
//   exactly the key the app is going to guess. This is not a convention we are
//   free to change — see frontend/src/components/ActivityCover.js.
// ---------------------------------------------------------------------------

// The same three folders POST /upload has always used, chosen by MIME type.
const FOLDER_IMAGES = 'iece_images';
const FOLDER_DOCS = 'iece_mous';
const FOLDER_OTHER = 'iece_uploads';

// Face recordings, in the private bucket. `_v2` is the per-school registration
// store; the unsuffixed folder is the legacy single-registration one and is
// never written to again.
const FOLDER_FACES = 'facial_registrations_v2';

const DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * Decide the folder, the stored format and the extension for one upload.
 *
 * The format decision is not a pass-through. HEIC is what an iPhone produces by
 * default, and almost nothing outside Apple's ecosystem will render it — a
 * banner uploaded as HEIC would be an invisible banner on every Android device.
 * Cloudinary quietly converted it via `f_auto`; here it is converted on the way
 * in, once, and stored as JPEG. PNG keeps its transparency, WebP stays WebP,
 * and animated GIFs are passed through untouched because resizing one with a
 * still-image pipeline silently throws the animation away.
 */
function classify(mimetype = '', originalName = '') {
  const mime = String(mimetype).toLowerCase();
  const ext = path.extname(originalName || '').toLowerCase().replace('.', '');

  if (DOC_MIMES.includes(mime) || ['pdf', 'doc', 'docx'].includes(ext)) {
    return { folder: FOLDER_DOCS, kind: 'doc', format: null, extension: ext || 'pdf' };
  }

  if (mime.startsWith('image/')) {
    if (mime === 'image/gif' || ext === 'gif') {
      return { folder: FOLDER_IMAGES, kind: 'image', format: 'gif', extension: 'gif', passthrough: true };
    }
    if (mime === 'image/png') {
      return { folder: FOLDER_IMAGES, kind: 'image', format: 'png', extension: 'png' };
    }
    if (mime === 'image/webp') {
      return { folder: FOLDER_IMAGES, kind: 'image', format: 'webp', extension: 'webp' };
    }
    // jpeg, heic, heif, tiff, bmp and anything else an image picker can produce.
    return { folder: FOLDER_IMAGES, kind: 'image', format: 'jpeg', extension: 'jpg' };
  }

  if (mime.startsWith('video/')) {
    return { folder: FOLDER_OTHER, kind: 'video', format: null, extension: ext || 'mp4' };
  }

  return { folder: FOLDER_OTHER, kind: 'other', format: null, extension: ext || 'bin' };
}

/**
 * A safe, readable stem for the key.
 *
 * Anything outside [A-Za-z0-9-_] becomes an underscore. Not paranoia about
 * storage — R2 accepts almost any byte — but about everything the name passes
 * through afterwards: a URL, a signature, a CSV of the migration, a shell
 * command someone runs while debugging. A '#' or a '?' in a filename turns a
 * URL into a different URL.
 */
function safeStem(originalName) {
  const base = path.basename(String(originalName || 'file'), path.extname(String(originalName || '')));
  const cleaned = base.normalize('NFKD').replace(/[^A-Za-z0-9\-_]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'file').slice(0, 60);
}

/**
 * Build the key for a new upload.
 *
 * The random suffix closes a collision the old scheme was quietly exposed to:
 * the public_id was `Date.now()` plus the filename, so two people uploading
 * `photo.jpg` in the same millisecond produced the same id and the second
 * overwrote the first. Rare, silent, and unrecoverable — six random characters
 * end it.
 */
function buildKey(mimetype, originalName, { folder } = {}) {
  const info = classify(mimetype, originalName);
  const dir = folder || info.folder;
  const token = crypto.randomBytes(3).toString('hex');
  return {
    ...info,
    key: `${dir}/${Date.now()}-${safeStem(originalName)}-${token}.${info.extension}`,
  };
}

/** The key for a face recording. Always the private bucket, always .mp4. */
function faceVideoKey(userId, schoolId) {
  const token = crypto.randomBytes(4).toString('hex');
  const scope = schoolId ? String(schoolId) : 'anonymous';
  return `${FOLDER_FACES}/${userId}-${scope}-${Date.now()}-${token}.mp4`;
}

/** `iece_images/1712-photo-a1b2c3.jpg` → `iece_images/1712-photo-a1b2c3_w480.jpg` */
function variantKey(key, width) {
  const ext = path.extname(key);
  return `${key.slice(0, key.length - ext.length)}_w${width}${ext}`;
}

/**
 * `iece_uploads/1712-clip-a1b2c3.mp4` → `iece_uploads/1712-clip-a1b2c3.jpg`
 *
 * The exact string an installed app build will construct and request.
 */
function posterKey(videoKey) {
  const ext = path.extname(videoKey);
  return `${videoKey.slice(0, videoKey.length - ext.length)}.jpg`;
}

// The widths stored for every image. They match the buckets
// frontend/src/utils/media.js already rounds to, so a future app build can ask
// for one by name instead of guessing.
const VARIANT_WIDTHS = [480, 1080];

// ---------------------------------------------------------------------------
// ONE MAPPING FROM EXTENSION TO CONTENT-TYPE.
//
// Both the live upload path and the migration copy job have to set this header,
// and they must agree exactly: a video migrated as `application/octet-stream`
// does not play, and nothing in the app reports why. Two lists in two files is
// how that kind of disagreement happens, so there is one list, here.
// ---------------------------------------------------------------------------
const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
};

/**
 * The Content-Type for a stored object, from its extension.
 *
 * Falls back to `application/octet-stream`, which is the honest answer for a
 * format we do not recognise — but a caller migrating a known image or video
 * should never reach it, so an unexpected octet-stream in the migration report
 * is a signal, not noise.
 */
function contentTypeFor(extensionOrKey) {
  const raw = String(extensionOrKey || '');
  const ext = (raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/**
 * Identify a file from its first bytes.
 *
 * Needed because Cloudinary public_ids do not always carry an extension. Two of
 * the documents in this account are stored with no extension at all and are
 * served as `application/octet-stream` — even though their first eight bytes
 * read `%PDF-1.5`. Copying that header across would faithfully reproduce a file
 * the app cannot open; sniffing gives it the type it actually is.
 *
 * Deliberately small: only the formats this app stores, only signatures that
 * cannot collide.
 */
function sniffContentType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12).toString('hex').toLowerCase();
  const ascii = buffer.subarray(0, 12).toString('latin1');

  if (ascii.startsWith('%PDF-')) return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // ISO base media: the box type sits at bytes 4-8.
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand.startsWith('avif') || brand.startsWith('mif1')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')) return 'image/heic';
    return 'video/mp4';
  }
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  // ZIP container — .docx and .xlsx both are, so this alone is not enough to
  // tell them apart and the extension has to win when there is one.
  if (hex.startsWith('504b0304')) return null;
  return null;
}

module.exports = {
  classify,
  contentTypeFor,
  sniffContentType,
  CONTENT_TYPES,
  buildKey,
  faceVideoKey,
  variantKey,
  posterKey,
  safeStem,
  VARIANT_WIDTHS,
  FOLDER_IMAGES,
  FOLDER_DOCS,
  FOLDER_OTHER,
  FOLDER_FACES,
};
