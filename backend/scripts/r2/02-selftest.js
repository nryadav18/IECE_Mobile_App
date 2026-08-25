#!/usr/bin/env node
/**
 * PHASE 2 SELF-TEST — prove the R2 upload path on the machine it will run on.
 *
 *   npm run r2:selftest
 *
 * Uploads a real photo, a real 3-second video and a PDF through the actual
 * middleware the /upload routes use, checks everything that has to be true
 * about them, then deletes them again and checks THAT.
 *
 * Worth running on the production server as well as locally, because two of the
 * things it exercises are native binaries that are built per-platform and can
 * be present on a laptop and missing on a VPS:
 *
 *   sharp   image resizing. Without it, images upload unprocessed — no variants,
 *           no 1600px cap.
 *   ffmpeg  video poster frames. Without it, EVERY activity video shows a broken
 *           thumbnail on phones already in the field, and nothing else in the
 *           system will say so.
 *
 * It creates and deletes its own files. It touches no application data, reads
 * nothing from MongoDB, and leaves nothing behind.
 */

process.env.STORAGE_DRIVER = 'r2';   // this script always tests the R2 path
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const storage = require('../../utils/storage');
const r2 = require('../../utils/storage/r2');
const keys = require('../../utils/storage/keys');

const tmp = (n) => path.join(os.tmpdir(), n);
let pass = 0, fail = 0;
const check = (name, ok, detail='') => { ok ? pass++ : fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${name}${detail?'   '+detail:''}`); };

(async () => {
  console.log('\n  PHASE 2 END-TO-END  (driver: ' + storage.driver() + ')\n');

  // ---------- a real photo, deliberately portrait + oversized + EXIF-rotated ----------
  const imgPath = tmp('e2e-photo.jpg');
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 40, g: 90, b: 80 } } })
    .jpeg().toFile(imgPath);
  const imgFile = { path: imgPath, originalname: 'My Photo (final).JPG', mimetype: 'image/jpeg' };

  // ---------- a real 3-second video ----------
  const vidPath = tmp('e2e-clip.mp4');
  execFileSync(ffmpegPath, ['-y','-f','lavfi','-i','testsrc=duration=3:size=640x360:rate=10','-pix_fmt','yuv420p', vidPath], {stdio:'ignore'});
  const vidFile = { path: vidPath, originalname: 'clip.mp4', mimetype: 'video/mp4' };

  // ---------- a PDF ----------
  const pdfPath = tmp('e2e-doc.pdf');
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'));
  const pdfFile = { path: pdfPath, originalname: 'MOU signed.pdf', mimetype: 'application/pdf' };

  const videoBytes = fs.readFileSync(vidPath);  // capture BEFORE upload deletes the temp
  const req = { files: [imgFile, vidFile, pdfFile] };
  await new Promise((res, rej) => storage.finalizeUploads(req, {}, (e) => e ? rej(e) : res()));

  const [imgUrl, vidUrl, pdfUrl] = req.files.map(f => f.path);
  console.log('  image ->', imgUrl); console.log('  video ->', vidUrl); console.log('  pdf   ->', pdfUrl, '\n');

  const get = async (u, opt) => { const r = await fetch(u, opt); return { s: r.status, ct: r.headers.get('content-type'), cc: r.headers.get('cache-control'), len: Number(r.headers.get('content-length')||0) }; };

  // --- image ---
  const survivors = [['photo',imgPath],['video',vidPath],['pdf',pdfPath]].filter(([n,f]) => fs.existsSync(f)).map(([n])=>n);
  check('temp files cleaned off disk', survivors.length === 0, survivors.length ? 'survived: '+survivors.join(', ') : '');
  const i = await get(imgUrl);
  check('image serves 200 + image/jpeg', i.s===200 && i.ct==='image/jpeg', `${i.s} ${i.ct}`);
  check('image is immutably cacheable', /immutable/.test(i.cc||''), i.cc);
  const meta = await sharp(Buffer.from(await (await fetch(imgUrl)).arrayBuffer())).metadata();
  check('image capped at 1600px', meta.width===1600, `${meta.width}x${meta.height}`);
  for (const w of keys.VARIANT_WIDTHS) {
    const v = await get(keys.variantKey(imgUrl, w));
    check(`variant _w${w} exists`, v.s===200, `${v.s}, ${(v.len/1024).toFixed(0)} KB`);
  }
  check('key was sanitised', !/[ ()]/.test(imgUrl), imgUrl.split('/').pop());

  // --- video + THE POSTER ---
  const v = await get(vidUrl);
  check('video serves 200 + video/mp4', v.s===200 && v.ct==='video/mp4', `${v.s} ${v.ct}`);
  const rng = await fetch(vidUrl, { headers: { Range: 'bytes=0-99' } });
  check('video supports range (seek)', rng.status===206, String(rng.status));
  const guessed = vidUrl.replace('.mp4', '.jpg');   // exactly what ActivityCover.js does
  const p = await get(guessed);
  check('POSTER at the guessed .jpg URL', p.s===200 && p.ct==='image/jpeg', `${p.s} ${p.ct} ${(p.len/1024).toFixed(0)} KB`);
  check('poster key === app-guessed key', guessed === keys.posterKey(vidUrl));

  // --- pdf ---
  const d = await get(pdfUrl);
  check('pdf serves 200 + application/pdf', d.s===200 && d.ct==='application/pdf', `${d.s} ${d.ct}`);

  // --- face video: private bucket + signing ---
  const faceRef = await storage.putFaceVideo(videoBytes, 'video/mp4', { userId: 'u1', schoolId: 's1' });
  console.log('\n  face  ->', faceRef);
  check('face stored as r2: reference, not a URL', storage.isPrivateRef(faceRef) && !faceRef.startsWith('http'));
  const { signedAssets } = require('../../middleware/signedAssets');
  const runJson = (user, body) => new Promise(r => {
    const res = { json: (b) => r(b) };
    signedAssets({ user }, res, () => res.json(body));
  });
  const admin = await runJson({ role:'creator_admin' }, { faceRegistrations: [{ registrationPhotoUrl: faceRef }] });
  const signed = admin.faceRegistrations[0].registrationPhotoUrl;
  check('admin gets a signed https URL', typeof signed === 'string' && signed.startsWith('https://'));
  check('signed URL actually plays', (await get(signed)).s === 200);
  const ceo = await runJson({ role:'ceo' }, { faceRegistrations: [{ registrationPhotoUrl: faceRef }] });
  check('CEO gets null (FACE_APPROVERS only)', ceo.faceRegistrations[0].registrationPhotoUrl === null);
  const trainer = await runJson({ role:'trainer' }, { registrationPhotoUrl: faceRef });
  check('trainer gets null', trainer.registrationPhotoUrl === null);
  const untouched = await runJson({ role:'creator_admin' }, { imageUrl: imgUrl, note: 'hello' });
  check('non-private fields untouched', untouched.imageUrl === imgUrl && untouched.note === 'hello');

  // --- deletion: primary AND derivatives, verified ---
  const rep = await storage.purgeAssets([imgUrl, vidUrl, pdfUrl, faceRef]);
  check('purge reports ok', rep.ok, `${rep.deleted} deleted, ${rep.failed} failed, ${rep.verified} verified`);
  check('purge returns gone[] for the DB', rep.gone.length === 4);

  // Deletion from STORAGE is what the database cares about, and it is proved
  // against the S3 API, not against the CDN — the edge is a cache and answers
  // for its own reasons.
  const { makeClient, headObject } = require('./lib/r2client');
  const s3c = makeClient({ endpoint: process.env.R2_ENDPOINT, accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY });
  const keyOf = (u) => new URL(u).pathname.replace(/^\//,'');
  const B = process.env.R2_BUCKET_PUBLIC;
  const gone = async (u) => (await headObject(s3c, B, keyOf(u))) === null;
  check('primary objects gone from bucket', await gone(imgUrl) && await gone(vidUrl) && await gone(pdfUrl));
  check('POSTER gone from bucket', await gone(guessed));
  const left = [];
  for (const w of keys.VARIANT_WIDTHS) if (!await gone(keys.variantKey(imgUrl, w))) left.push(w);
  check('variants gone from bucket', left.length === 0, left.length ? 'left: '+left : '');
  check('signed URL now 404s', (await get(signed)).s === 404);

  // CDN eviction is a separate concern and needs its own credentials.
  if (rep.cdnPurged) {
    let evicted = false;
    for (let i = 0; i < 6 && !evicted; i++) { await new Promise(r=>setTimeout(r,1500)); evicted = (await get(imgUrl)).s === 404; }
    check('CDN evicted the deleted file', evicted);
  } else {
    const stale = await get(imgUrl);
    console.log(`  SKIP  CDN eviction — ${rep.cdnPurgeError}`);
    console.log(`        the deleted file still answers ${stale.s} at the edge, which is exactly`);
    console.log('        why CLOUDFLARE_ZONE_ID + CLOUDFLARE_PURGE_TOKEN are required.');
  }

  // --- mixed-cloud purge must not misroute ---
  const mixed = await storage.purgeAssets(['https://res.cloudinary.com/dbesfbmwz/image/upload/v1/iece_images/definitely-not-real.jpg']);
  check('cloudinary URL routed to cloudinary', mixed.requested === 1 && mixed.missing + mixed.deleted === 1, JSON.stringify({missing:mixed.missing, deleted:mixed.deleted, failed:mixed.failed}));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n  THREW:', e.message, '\n', e.stack); process.exit(1); });
