#!/usr/bin/env node
/**
 * PHASE 0 — measure what actually exists, before anything moves.
 *
 *   node scripts/r2/00-audit.js
 *
 * THIS SCRIPT WRITES NOTHING, ANYWHERE. It opens MongoDB read-only, reads the
 * Cloudinary account through the Admin API, and puts a report on your disk. No
 * document is modified, no asset is touched, nothing is uploaded or deleted.
 * It is safe to run against production at any time, as many times as you like.
 *
 * It answers the question the whole migration rests on — "what are we moving?" —
 * by reconciling two lists that have never been compared before:
 *
 *   REFERENCED   a URL in one of the seven database fields, whose asset really
 *                is in the Cloudinary account. This is the migration scope, and
 *                nothing outside it needs to be copied.
 *
 *   ORPHAN       an asset in Cloudinary that no database record points at. Left
 *                behind deliberately: copying it would pay to store a file
 *                nothing can reach. It dies with the account in Phase 6.
 *
 *   DANGLING     a URL in the database whose asset is NOT in Cloudinary. These
 *                are already broken today — the picture is gone and the record
 *                still points at it. They matter enormously here, because a
 *                copy job cannot copy them and would otherwise report them as
 *                failures, making a clean migration look defective. Knowing the
 *                number in advance is what turns "63 files failed" into "63
 *                files were already missing before we started".
 *
 *   EXTERNAL     a URL that is not Cloudinary at all (a seeded placeholder, an
 *                already-migrated R2 URL). Reported, never touched.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const { cloudinaryConfig, r2Config, ConfigError } = require('./lib/env');
const { connect, disconnect } = require('./lib/mongo');
const { URL_FIELDS, readField, projectionFor, filterFor, label } = require('./lib/urlFields');
const { parseCloudinaryUrl, isAccountBlocked } = require('../../utils/cloudinary');

const OUT_DIR = path.join(__dirname, 'output');

// Cloudinary keeps images, videos and raw files in separate namespaces; the same
// public_id can exist in all three. Every listing and every lookup has to name
// which one it means, which is why resource type is part of the match key below.
const RESOURCE_TYPES = ['image', 'video', 'raw'];

// A runaway-pagination backstop. 400 pages x 500 assets is 200,000 files — far
// beyond anything this account can plausibly hold, so hitting it means the
// cursor is not advancing rather than that the account is enormous.
const MAX_PAGES = 400;

const bytesHuman = (n) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/* ------------------------------------------------------------------ *
 * 1. Every URL the database references                                *
 * ------------------------------------------------------------------ */

async function collectReferences(db) {
  // url -> [{ field, recordId, index }]
  const references = new Map();
  const perField = [];

  for (const spec of URL_FIELDS) {
    // The collection name comes from the model rather than being hard-coded, so
    // this cannot drift if a schema is ever renamed.
    const Model = require(path.join(__dirname, '..', '..', 'models', spec.model));
    const collectionName = Model.collection.name;
    const fieldLabel = label(spec);

    let docs = 0;
    let urls = 0;

    const cursor = db.collection(collectionName)
      .find(filterFor(spec), { projection: projectionFor(spec) })
      .batchSize(500);

    for await (const doc of cursor) {
      const found = readField(doc, spec);
      if (!found.length) continue;
      docs += 1;
      for (const { value, index } of found) {
        urls += 1;
        if (!references.has(value)) references.set(value, []);
        references.get(value).push({
          field: fieldLabel,
          collection: collectionName,
          recordId: String(doc._id),
          index,
          bucket: spec.bucket,
        });
      }
    }

    perField.push({
      field: fieldLabel,
      collection: collectionName,
      holds: spec.holds,
      bucket: spec.bucket,
      documents: docs,
      urls,
    });

    process.stdout.write(`  ${pad(fieldLabel, 46)} ${padL(urls, 7)} url(s) across ${docs} document(s)\n`);
  }

  return { references, perField };
}

/* ------------------------------------------------------------------ *
 * 2. Every asset the Cloudinary account holds                         *
 * ------------------------------------------------------------------ */

async function listCloudinaryAssets() {
  // "<resource_type>|<public_id>" -> asset
  const assets = new Map();
  let totalBytes = 0;

  for (const resourceType of RESOURCE_TYPES) {
    let cursor;
    let page = 0;
    let count = 0;

    do {
      let response;
      try {
        response = await cloudinary.api.resources({
          resource_type: resourceType,
          type: 'upload',
          max_results: 500,
          next_cursor: cursor,
        });
      } catch (error) {
        if (isAccountBlocked(error)) {
          throw new Error(
            'Cloudinary is refusing every request — the account is suspended or out of '
            + 'credits. This is also why images are not loading in the app. Nothing can be '
            + 'audited or migrated until it is restored.\n  '
            + (error?.message || error?.error?.message || String(error))
          );
        }
        throw error;
      }

      for (const r of response.resources || []) {
        assets.set(`${r.resource_type}|${r.public_id}`, {
          publicId: r.public_id,
          resourceType: r.resource_type,
          deliveryType: r.type,
          format: r.format || null,
          bytes: r.bytes || 0,
          createdAt: r.created_at || null,
          secureUrl: r.secure_url || null,
          folder: r.public_id.includes('/') ? r.public_id.slice(0, r.public_id.lastIndexOf('/')) : '(root)',
        });
        totalBytes += r.bytes || 0;
        count += 1;
      }

      cursor = response.next_cursor;
      page += 1;
    } while (cursor && page < MAX_PAGES);

    if (cursor) {
      throw new Error(
        `Stopped paginating ${resourceType} assets after ${MAX_PAGES} pages. Either the `
        + 'account is larger than expected or the cursor is not advancing — do not treat '
        + 'this audit as complete.'
      );
    }

    process.stdout.write(`  ${pad(resourceType, 10)} ${padL(count, 7)} asset(s)\n`);
  }

  return { assets, totalBytes };
}

/* ------------------------------------------------------------------ *
 * 3. Reconcile                                                        *
 * ------------------------------------------------------------------ */

/**
 * Find the account asset a stored URL points at.
 *
 * The extension retry is not defensive padding. Images and videos keep their
 * format OUTSIDE the public_id; raw files (the PDFs and Word documents in
 * `iece_mous`) usually keep it INSIDE. Looking a PDF up without its extension
 * answers "not found" for a file that is plainly there — which would classify a
 * perfectly healthy MOU as a dangling reference and quietly drop it from the
 * migration. The same retry exists in utils/cloudinary.js for the same reason.
 */
function findAsset(assets, parsed) {
  const direct = assets.get(`${parsed.resourceType}|${parsed.publicId}`);
  if (direct) return direct;
  if (parsed.extension) {
    const withExt = assets.get(`${parsed.resourceType}|${parsed.publicId}.${parsed.extension}`);
    if (withExt) return withExt;
  }
  return null;
}

function reconcile(references, assets, publicBaseUrl) {
  const referenced = [];   // in DB and in Cloudinary — the migration scope
  const dangling = [];     // in DB, not in Cloudinary — already broken today
  const external = [];     // not a Cloudinary URL at all
  const matchedKeys = new Set();

  for (const [url, uses] of references) {
    const isCloudinary = url.includes('res.cloudinary.com') || url.includes('cloudinary.com');
    const isR2 = publicBaseUrl && (url.startsWith(publicBaseUrl) || url.startsWith('r2:'));

    if (!isCloudinary) {
      external.push({ url, uses, kind: isR2 ? 'already-r2' : 'other' });
      continue;
    }

    const parsed = parseCloudinaryUrl(url);
    if (!parsed) {
      // A Cloudinary-looking URL the parser cannot break down. Worth surfacing
      // loudly: the copy job would not know what to ask for either.
      dangling.push({ url, uses, reason: 'could not be parsed into a public_id' });
      continue;
    }

    const asset = findAsset(assets, parsed);
    if (!asset) {
      dangling.push({
        url,
        uses,
        reason: 'not present in the Cloudinary account',
        publicId: parsed.publicId,
        resourceType: parsed.resourceType,
      });
      continue;
    }

    matchedKeys.add(`${asset.resourceType}|${asset.publicId}`);
    referenced.push({
      url,
      uses,
      publicId: asset.publicId,
      resourceType: asset.resourceType,
      format: asset.format,
      bytes: asset.bytes,
      folder: asset.folder,
      // Mirroring the Cloudinary layout means the R2 key is the public_id plus
      // the extension the delivery URL already carries. Derived here so the
      // audit reports the exact key the copy job will write.
      r2Key: parsed.extension && !asset.publicId.endsWith(`.${parsed.extension}`)
        ? `${asset.publicId}.${parsed.extension}`
        : asset.publicId,
      bucket: uses[0].bucket,
    });
  }

  const orphans = [];
  for (const [key, asset] of assets) {
    if (!matchedKeys.has(key)) orphans.push(asset);
  }

  return { referenced, dangling, external, orphans };
}

/* ------------------------------------------------------------------ *
 * 4. Report                                                           *
 * ------------------------------------------------------------------ */

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRows = (header, rows) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');

function writeOut(name, contents) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, { count: 0, bytes: 0 });
    const g = out.get(k);
    g.count += 1;
    g.bytes += item.bytes || 0;
    out.set(k, g);
  }
  return out;
}

async function main() {
  let cfg;
  let cloud;
  try {
    cloud = cloudinaryConfig();
    // The R2 side is optional here — the audit is useful before R2 exists at
    // all. It is only read so an already-migrated URL can be recognised.
    try { cfg = r2Config(); } catch { cfg = null; }
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  Configuration problem\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  cloudinary.config({
    cloud_name: cloud.cloudName,
    api_key: cloud.apiKey,
    api_secret: cloud.apiSecret,
    secure: true,
  });

  console.log('\n  CLOUDINARY → R2 MIGRATION AUDIT');
  console.log('  Read-only. Nothing is modified, uploaded or deleted.\n');

  // ---- MongoDB ----------------------------------------------------------
  console.log('  Reading MongoDB…\n');
  const connection = await connect();
  const db = connection.db;
  console.log(`  connected to "${db.databaseName}"\n`);

  const { references, perField } = await collectReferences(db);
  const distinctUrls = references.size;
  const totalUses = [...references.values()].reduce((n, uses) => n + uses.length, 0);
  console.log(`\n  ${distinctUrls} distinct URL(s), referenced ${totalUses} time(s).\n`);

  // ---- Cloudinary -------------------------------------------------------
  console.log(`  Reading the Cloudinary account "${cloud.cloudName}"…\n`);
  const { assets, totalBytes } = await listCloudinaryAssets();
  console.log(`\n  ${assets.size} asset(s) in the account, ${bytesHuman(totalBytes)} total.\n`);

  // ---- Reconcile --------------------------------------------------------
  const { referenced, dangling, external, orphans } =
    reconcile(references, assets, cfg ? cfg.publicBaseUrl : null);

  const migrateBytes = referenced.reduce((n, r) => n + r.bytes, 0);
  const orphanBytes = orphans.reduce((n, r) => n + r.bytes, 0);
  const videos = referenced.filter((r) => r.resourceType === 'video');
  const images = referenced.filter((r) => r.resourceType === 'image');
  const raws = referenced.filter((r) => r.resourceType === 'raw');
  const shared = [...references.entries()].filter(([, uses]) => uses.length > 1);

  const line = '  ' + '─'.repeat(74);
  console.log(line);
  console.log('  RESULT\n');
  console.log(`  MIGRATE    ${padL(referenced.length, 7)} file(s)   ${padL(bytesHuman(migrateBytes), 10)}   referenced and present`);
  console.log(`  DANGLING   ${padL(dangling.length, 7)} file(s)   ${padL('—', 10)}   referenced but MISSING from Cloudinary`);
  console.log(`  ORPHAN     ${padL(orphans.length, 7)} file(s)   ${padL(bytesHuman(orphanBytes), 10)}   in Cloudinary, referenced by nothing`);
  console.log(`  EXTERNAL   ${padL(external.length, 7)} url(s)   ${padL('—', 10)}   not Cloudinary URLs at all`);
  console.log(line);

  console.log('\n  WHAT GETS COPIED\n');
  console.log(`  images     ${padL(images.length, 7)}   ${bytesHuman(images.reduce((n, r) => n + r.bytes, 0))}`);
  console.log(`             ${padL('', 7)}   + ${images.length * 2} resized variants generated on the way (_w480, _w1080)`);
  console.log(`  videos     ${padL(videos.length, 7)}   ${bytesHuman(videos.reduce((n, r) => n + r.bytes, 0))}`);
  console.log(`             ${padL('', 7)}   + ${videos.length} poster frame(s) — REQUIRED, old app builds guess .mp4 → .jpg`);
  console.log(`  raw/docs   ${padL(raws.length, 7)}   ${bytesHuman(raws.reduce((n, r) => n + r.bytes, 0))}`);

  const byFolder = groupBy(referenced, (r) => r.folder);
  console.log('\n  BY FOLDER\n');
  for (const [folder, g] of [...byFolder].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${pad(folder, 28)} ${padL(g.count, 7)}   ${padL(bytesHuman(g.bytes), 10)}`);
  }

  const byBucket = groupBy(referenced, (r) => r.bucket);
  console.log('\n  BY DESTINATION BUCKET\n');
  for (const [bucket, g] of byBucket) {
    const name = bucket === 'private'
      ? (cfg ? cfg.bucketPrivate : 'private bucket')
      : (cfg ? cfg.bucketPublic : 'public bucket');
    console.log(`  ${pad(`${name} (${bucket})`, 28)} ${padL(g.count, 7)}   ${padL(bytesHuman(g.bytes), 10)}`);
  }

  // A rough figure, deliberately generous: variants and posters add objects and
  // bytes that the source listing knows nothing about.
  const estBytes = migrateBytes * 1.35;
  const estStorage = (estBytes / 1024 ** 3) * 0.015;
  const estWrites = ((referenced.length + images.length * 2 + videos.length) / 1e6) * 4.5;
  console.log('\n  ESTIMATED R2 COST\n');
  console.log(`  storage    ~${bytesHuman(estBytes)} → $${estStorage.toFixed(2)}/month  (first 10 GB free)`);
  console.log(`  one-off writes for the migration → $${estWrites.toFixed(2)}  (first 1M free)`);
  console.log('  egress     $0.00 — always, on any volume');

  if (shared.length) {
    console.log(`\n  NOTE  ${shared.length} file(s) are referenced by more than one record.`);
    console.log('        They are copied once and every reference is repointed. Listed in the JSON.');
  }

  // ---- Files ------------------------------------------------------------
  const stamp = new Date().toISOString();
  const report = {
    generatedAt: stamp,
    database: db.databaseName,
    cloudinaryCloud: cloud.cloudName,
    r2: cfg ? { publicBucket: cfg.bucketPublic, privateBucket: cfg.bucketPrivate, publicBaseUrl: cfg.publicBaseUrl } : null,
    totals: {
      distinctUrls,
      totalReferences: totalUses,
      accountAssets: assets.size,
      accountBytes: totalBytes,
      migrate: referenced.length,
      migrateBytes,
      dangling: dangling.length,
      orphans: orphans.length,
      orphanBytes,
      external: external.length,
      images: images.length,
      videos: videos.length,
      raw: raws.length,
      sharedUrls: shared.length,
    },
    perField,
    referenced,
    dangling,
    external,
    orphans,
    sharedUrls: shared.map(([url, uses]) => ({ url, uses })),
  };

  const files = [];
  files.push(writeOut('audit.json', JSON.stringify(report, null, 2)));

  files.push(writeOut('referenced.csv', csvRows(
    ['url', 'r2Key', 'bucket', 'resourceType', 'format', 'bytes', 'folder', 'referencedBy', 'recordIds'],
    referenced.map((r) => [
      r.url, r.r2Key, r.bucket, r.resourceType, r.format, r.bytes, r.folder,
      r.uses.map((u) => u.field).join(' | '),
      r.uses.map((u) => u.recordId).join(' | '),
    ])
  )));

  if (dangling.length) {
    files.push(writeOut('dangling.csv', csvRows(
      ['url', 'reason', 'publicId', 'resourceType', 'referencedBy', 'recordIds'],
      dangling.map((d) => [
        d.url, d.reason, d.publicId || '', d.resourceType || '',
        d.uses.map((u) => u.field).join(' | '),
        d.uses.map((u) => u.recordId).join(' | '),
      ])
    )));
  }

  if (orphans.length) {
    files.push(writeOut('orphans.csv', csvRows(
      ['publicId', 'resourceType', 'format', 'bytes', 'folder', 'createdAt'],
      orphans.map((o) => [o.publicId, o.resourceType, o.format, o.bytes, o.folder, o.createdAt])
    )));
  }

  console.log('\n  WRITTEN\n');
  for (const f of files) console.log(`  ${path.relative(process.cwd(), f)}`);

  // ---- Gate 0 -----------------------------------------------------------
  console.log(`\n${line}`);
  if (dangling.length) {
    console.log('  GATE 0 — NOT CLEAR\n');
    console.log(`  ${dangling.length} database reference(s) point at files that are not in the`);
    console.log('  Cloudinary account. These are already broken in the live app today —');
    console.log('  the migration did not cause them and cannot repair them.');
    console.log('\n  Open output/dangling.csv and decide, for each one, whether to clear the');
    console.log('  field or leave it. Then re-run this audit. Do not start Phase 3 until this');
    console.log('  number is understood, or a copy job will report them as failures.');
  } else {
    console.log('  GATE 0 — CLEAR\n');
    console.log('  Every URL in the database resolves to a real asset in Cloudinary.');
    console.log('  Nothing is missing. Phase 1 (node scripts/r2/01-verify.js) is next.');
  }
  console.log(`${line}\n`);

  await disconnect();
  process.exit(dangling.length ? 2 : 0);
}

main().catch(async (error) => {
  console.error('\n  Audit failed:\n');
  console.error(`  ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  await disconnect();
  process.exit(1);
});
