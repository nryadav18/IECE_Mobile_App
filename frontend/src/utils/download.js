import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let File, Directory, Paths, Legacy, MediaLibrary, Sharing;
if (Platform.OS !== 'web') {
  const FileSystem = require('expo-file-system');
  File = FileSystem.File;
  Directory = FileSystem.Directory;
  Paths = FileSystem.Paths;
  Legacy = require('expo-file-system/legacy');
  MediaLibrary = require('expo-media-library');
  Sharing = require('expo-sharing');
}

/**
 * Saving any file from the app to the phone, so it survives offline.
 *
 * The two operating systems disagree fundamentally about where a downloaded
 * file belongs, so one code path cannot serve both. What they DO agree on:
 *
 *   Photos and videos  -> the system photo library. Both platforms have one and
 *                         both index it offline, so media shows up in Gallery /
 *                         Photos immediately. We add to it with ADD-ONLY
 *                         permission and never read it back.
 *
 *   Everything else    -> Android has a real user-visible filesystem, so a PDF
 *   (PDF, doc, ...)       goes into a folder the user picks once (Downloads by
 *                         default) via the Storage Access Framework, and stays
 *                         there. iOS has no such folder for third-party apps —
 *                         the supported route is the share sheet's "Save to
 *                         Files", which is exactly what every iOS app does.
 *
 * Every function returns a plain { ok, message } so callers can just show it.
 */

// The folder documents land in, so a user can find IECE files in one place
// rather than scattered through their storage.
export const DOWNLOAD_FOLDER = 'IECE';

// Where Android's chosen download folder is remembered, so the user is asked
// to pick one once rather than on every single download.
const SAF_DIR_KEY = '@iece/download_dir_uri';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'];

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
};

/** Extension from a URL, ignoring query strings and Cloudinary transforms. */
export function extensionOf(url = '') {
  const clean = String(url).split('?')[0].split('#')[0];
  const last = clean.substring(clean.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot === -1) return '';
  return last.substring(dot + 1).toLowerCase();
}

export function isImage(url) { return IMAGE_EXT.includes(extensionOf(url)); }
export function isVideo(url) {
  const e = extensionOf(url);
  // Cloudinary serves videos from a /video/ path even when the extension is odd.
  return VIDEO_EXT.includes(e) || String(url).includes('/video/upload/');
}
export function isMedia(url) { return isImage(url) || isVideo(url); }

export function mimeOf(url) {
  return MIME[extensionOf(url)] || (isVideo(url) ? 'video/mp4' : 'application/octet-stream');
}

/**
 * A safe, human-readable filename. Strips anything a filesystem could choke on
 * and guarantees an extension, because Android infers the file type from it.
 */
export function safeFileName(url, preferred) {
  const ext = extensionOf(url) || (isVideo(url) ? 'mp4' : 'bin');
  const raw = preferred
    || decodeURIComponent(String(url).split('?')[0].split('/').pop() || '')
    || `iece-file.${ext}`;

  let name = raw.replace(/[^\w.\- ]+/g, '_').trim() || `iece-file.${ext}`;
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name}.${ext}`;
  // Keep it well under any filesystem limit while staying recognisable.
  return name.length > 80 ? name.slice(-80) : name;
}

/** Pull the remote file into app-private cache first. */
async function fetchToCache(url, filename) {
  const dir = new Directory(Paths.cache, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true });

  // Drop a stale copy so a re-download never serves yesterday's file.
  const target = new File(dir, filename);
  if (target.exists) target.delete();

  return File.downloadFileAsync(url, target);
}

/* ------------------------------------------------------------------ */
/* Photos & videos -> the system photo library                         */
/* ------------------------------------------------------------------ */

async function saveToPhotoLibrary(localUri) {
  // ADD-ONLY access. The app never reads or browses the user's library — it only
  // hands it a file it just downloaded — so it asks for the narrowest permission
  // that exists for that. This matters beyond good manners: Google Play's Photo
  // and Video Permissions policy rejects apps that declare broad READ_MEDIA_*
  // access when a narrower route would do, and Apple shows a far softer prompt
  // for add-only than for full library access.
  //
  // On Android 13+ this needs no runtime permission at all (the file goes in
  // through MediaStore), so nothing is prompted; on Android 12 and below it asks
  // for legacy write, and on iOS it asks only for "Add to Photos".
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    return {
      ok: false,
      message: 'Permission to save to your photos was denied. Allow it in Settings and try again.',
    };
  }

  // Deliberately no album grouping: putting the file in a named album means
  // first looking the album up, and looking anything up is read access — the
  // exact thing add-only buys us out of. The file lands in the gallery where
  // every other download does, which is where users look for it anyway.
  await MediaLibrary.Asset.create(localUri);

  return {
    ok: true,
    message: `Saved to your ${Platform.OS === 'ios' ? 'Photos' : 'Gallery'}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/** The Android folder the user picked, if it is still granted to us. */
async function rememberedAndroidDir() {
  try {
    return (await AsyncStorage.getItem(SAF_DIR_KEY)) || null;
  } catch {
    return null;
  }
}

async function saveDocumentAndroid(file, filename, mimeType) {
  let dirUri = await rememberedAndroidDir();

  if (!dirUri) {
    // Asked ONCE. Android hands back a long-lived grant for that folder, so
    // every later download lands there with no prompt at all.
    const initial = Legacy.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const perm = await Legacy.StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
    if (!perm.granted) {
      return { ok: false, message: 'No folder was chosen, so the file was not saved.' };
    }
    dirUri = perm.directoryUri;
    try { await AsyncStorage.setItem(SAF_DIR_KEY, dirUri); } catch {}
  }

  const base64 = await Legacy.readAsStringAsync(file.uri, { encoding: 'base64' });

  let destUri;
  try {
    destUri = await Legacy.StorageAccessFramework.createFileAsync(dirUri, filename, mimeType);
  } catch (e) {
    // The saved grant can be revoked (folder deleted, permissions cleared).
    // Forget it so the next attempt asks again instead of failing forever.
    try { await AsyncStorage.removeItem(SAF_DIR_KEY); } catch {}
    return { ok: false, message: 'That download folder is no longer available. Please try again and pick a folder.' };
  }

  await Legacy.writeAsStringAsync(destUri, base64, { encoding: 'base64' });
  return { ok: true, message: `Saved "${filename}" to your chosen folder. Open it from the Files app.` };
}

async function saveDocumentIOS(file, filename, mimeType) {
  // iOS gives third-party apps no shared folder, so the file is kept in the
  // app's own documents and handed to the share sheet — "Save to Files" puts it
  // wherever the user wants, including On My iPhone / iCloud Drive.
  const dir = new Directory(Paths.document, DOWNLOAD_FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });

  const dest = new File(dir, filename);
  if (dest.exists) dest.delete();
  await file.copy(dest);

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: true, message: `Saved "${filename}" inside the app's files.` };
  }

  await Sharing.shareAsync(dest.uri, {
    mimeType,
    dialogTitle: `Save ${filename}`,
    UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
  });
  return { ok: true, message: `Choose "Save to Files" to keep "${filename}" on your device.` };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Download ANY file the app shows — image, video, PDF, document — and put it
 * somewhere the user can reach offline.
 *
 * @param {string} url        remote file URL (Cloudinary, S3, anything public)
 * @param {object} [opts]
 * @param {string} [opts.filename]  preferred name; derived from the URL otherwise
 * @param {string} [opts.mimeType]  override the guessed MIME type
 * @returns {Promise<{ok: boolean, message: string}>} always resolves — never throws
 */
export async function downloadFile(url, { filename, mimeType } = {}) {
  if (!url || typeof url !== 'string') {
    return { ok: false, message: 'There is no file to download here.' };
  }

  const name = safeFileName(url, filename);
  const mime = mimeType || mimeOf(url);

  if (Platform.OS === 'web') {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { ok: true, message: 'Download started.' };
    } catch (e) {
      return { ok: false, message: 'Could not download the file on this browser.' };
    }
  }

  let file;
  try {
    file = await fetchToCache(url, name);
  } catch (e) {
    return { ok: false, message: 'Could not download the file. Check your connection and try again.' };
  }

  try {
    if (isMedia(url)) return await saveToPhotoLibrary(file.uri);
    return Platform.OS === 'android'
      ? await saveDocumentAndroid(file, name, mime)
      : await saveDocumentIOS(file, name, mime);
  } catch (e) {
    return { ok: false, message: e?.message || 'Could not save the file to your device.' };
  } finally {
    // The cache copy has served its purpose either way; leaving it behind would
    // quietly grow the app's storage with every download.
    try { if (file?.exists) file.delete(); } catch {}
  }
}

/** Forget the remembered Android folder so the next download asks again. */
export async function resetDownloadFolder() {
  try { await AsyncStorage.removeItem(SAF_DIR_KEY); } catch {}
}
