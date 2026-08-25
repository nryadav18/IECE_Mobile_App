const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

// sharp keeps decoded files in an internal cache, which on Windows means it can
// still be holding an open handle to the source when we try to delete it. The
// unlink then fails, the temp file survives, and because deletion is
// best-effort the failure is invisible — every upload leaves a copy behind
// until the disk fills. Linux would let the unlink through regardless, so this
// is a bug that never reproduces on the server and always reproduces on a
// developer's machine. Turning the cache off costs nothing at these sizes.
sharp.cache(false);

// ---------------------------------------------------------------------------
// THE TWO THINGS CLOUDINARY DID ON THE FLY AND R2 WILL NOT.
//
// Cloudinary resized images and invented video poster frames on demand, from a
// URL. R2 stores bytes and serves them back; it transforms nothing. Both jobs
// therefore move to upload time, and both are done here.
//
// The distinction that matters between them:
//
//   RESIZING is an optimisation. If it fails, the original is stored and every
//   screen still shows the right picture, just heavier. Degrade quietly.
//
//   THE POSTER IS NOT. Installed builds construct the poster URL themselves by
//   swapping .mp4 for .jpg. If that file is absent the thumbnail is broken on
//   every phone in the field, and nothing in the app will report it. A failure
//   here is logged as an error, loudly, because the alternative is a silent
//   regression nobody notices until someone opens the activity list.
// ---------------------------------------------------------------------------

// A camera photo is several megabytes of pixels nothing in the app can display.
// 1600px is comfortably above the largest surface any screen renders, and it is
// a LIMIT, not a target: `withoutEnlargement` means a small image is never
// blown up, which is what Cloudinary's `c_limit` did.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;

/** Where intermediate files live. Everything written here is deleted again. */
function tempPath(suffix) {
  return path.join(os.tmpdir(), `iece-${crypto.randomBytes(6).toString('hex')}${suffix}`);
}

async function removeQuietly(file, attempts = 3) {
  if (!file) return true;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fs.promises.unlink(file);
      return true;
    } catch (error) {
      // Already gone is the outcome we wanted.
      if (error.code === 'ENOENT') return true;
      // EBUSY/EPERM on Windows means something still has the handle open — a
      // virus scanner, or a stream that has not finished closing. A short wait
      // clears it; retrying is far cheaper than leaking the file.
      if (i === attempts - 1) {
        console.warn(`[storage] could not delete temp file ${file}: ${error.message}`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  return false;
}

/**
 * Re-encode and cap one image, then produce the stored variants.
 *
 * Returns null when the file should be stored byte-for-byte as it arrived —
 * animated GIFs (a still-image resize throws the animation away) and anything
 * sharp cannot decode. Storing the original unchanged is always a correct
 * answer; storing a broken derivative is not.
 *
 * @returns {Promise<{main: Buffer, contentType: string, variants: Array<{width:number, buffer:Buffer}>}|null>}
 */
async function processImage(sourcePath, { format, passthrough }) {
  if (passthrough) return null;

  const encode = (pipeline) => {
    if (format === 'png') return pipeline.png({ compressionLevel: 9 });
    if (format === 'webp') return pipeline.webp({ quality: WEBP_QUALITY });
    return pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  };

  const contentType = format === 'png' ? 'image/png'
    : format === 'webp' ? 'image/webp'
      : 'image/jpeg';

  try {
    // `.rotate()` with no argument applies the EXIF orientation and then drops
    // it. Without this, a photo taken in portrait on a phone is stored rotated
    // — correct on any viewer that reads EXIF, sideways everywhere else.
    const base = () => sharp(sourcePath, { failOn: 'none' }).rotate();

    const main = await encode(
      base().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    ).toBuffer();

    const meta = await sharp(main).metadata();

    const variants = [];
    for (const width of require('./keys').VARIANT_WIDTHS) {
      // Every width is always written, even when the source is already narrower
      // than the target. `withoutEnlargement` means such a "variant" is really
      // just a re-encode of the original, so it costs a few kilobytes — and in
      // exchange the client can ask for any bucket width and be certain it
      // exists. Skipping them to save space is what makes a resized URL a
      // gamble: 23% of the migrated images turned out to be narrower than 1080,
      // and a frontend that requested that width would have 404'd on every one.
      const buffer = await encode(
        base().resize({ width, fit: 'inside', withoutEnlargement: true })
      ).toBuffer();
      variants.push({ width, buffer });
    }

    return { main, contentType, variants };
  } catch (error) {
    console.warn(
      `[storage] image processing failed for ${path.basename(sourcePath)} — `
      + `storing the original unchanged. ${error.message}`
    );
    return null;
  }
}

/**
 * Extract a poster frame from a video.
 *
 * Seeks one second in rather than to frame zero: the opening frame of a
 * phone-shot clip is very often black or a blur while the sensor settles, and a
 * black thumbnail reads as a broken thumbnail. `-frames:v 1` after the seek
 * keeps this cheap — ffmpeg decodes one frame, not the file.
 *
 * @returns {Promise<Buffer>} JPEG bytes
 */
function extractPoster(videoPath) {
  return new Promise((resolve, reject) => {
    const out = tempPath('.jpg');
    ffmpeg(videoPath)
      .inputOptions(['-ss', '1'])
      .outputOptions(['-frames:v', '1', '-q:v', '3', '-vf', `scale='min(${MAX_EDGE},iw)':-2`])
      .on('error', async (error) => {
        await removeQuietly(out);
        reject(error);
      })
      .on('end', async () => {
        try {
          const buffer = await fs.promises.readFile(out);
          await removeQuietly(out);
          if (!buffer.length) throw new Error('ffmpeg produced an empty poster');
          resolve(buffer);
        } catch (error) {
          await removeQuietly(out);
          reject(error);
        }
      })
      .save(out);
  });
}

/**
 * The poster for a video, or null if one could not be made.
 *
 * A video shorter than the one-second seek yields nothing on the first attempt,
 * so it retries from frame zero before giving up. Never throws: a poster that
 * cannot be produced must not stop somebody uploading their video.
 */
async function makePoster(videoPath) {
  try {
    return await extractPoster(videoPath);
  } catch (first) {
    try {
      return await new Promise((resolve, reject) => {
        const out = tempPath('.jpg');
        ffmpeg(videoPath)
          .outputOptions(['-frames:v', '1', '-q:v', '3'])
          .on('error', async (e) => { await removeQuietly(out); reject(e); })
          .on('end', async () => {
            const buffer = await fs.promises.readFile(out).catch(() => null);
            await removeQuietly(out);
            if (buffer && buffer.length) resolve(buffer); else reject(new Error('empty'));
          })
          .save(out);
      });
    } catch (second) {
      // Loud on purpose. This is the failure that breaks video thumbnails on
      // phones already in the field, and nothing else in the system will
      // mention it. See scripts/r2/03-verify.js, which fails the whole
      // migration on a missing poster.
      console.error(
        `[storage] POSTER GENERATION FAILED for ${path.basename(videoPath)}. `
        + 'The video will upload, but installed app builds will show a broken '
        + `thumbnail for it. first attempt: ${first.message}; retry: ${second.message}`
      );
      return null;
    }
  }
}

module.exports = { processImage, makePoster, tempPath, removeQuietly, MAX_EDGE };
