#!/usr/bin/env node
/**
 * PHASE 1 — prove the R2 configuration actually works, before anything depends on it.
 *
 *   node scripts/r2/01-verify.js
 *
 * Round-trips a small test object through both buckets and checks the things
 * that are silently wrong far more often than they are loudly broken:
 *
 *   - the API token can see BOTH buckets (a token scoped to one bucket
 *     authenticates perfectly and then fails on the other, hours later);
 *   - the custom domain serves the public bucket, over HTTPS, with the
 *     Content-Type the object was stored with — the header that decides whether
 *     a video plays or a PDF downloads as junk;
 *   - range requests work, which is what expo-video needs to seek;
 *   - the PRIVATE bucket is genuinely private: reachable with a signed URL,
 *     refused without one, and not exposed through the public domain.
 *
 * Everything it creates, it deletes. It touches no application data and no
 * Cloudinary asset. Exit code 0 means every check passed.
 */

const { r2Config, ConfigError } = require('./lib/env');
const {
  makeClient, putObject, headObject, deleteObject, signGetUrl, probeBucket,
} = require('./lib/r2client');

// A prefix nothing else will ever use, so a leftover from an interrupted run is
// obvious for what it is and safe to delete by hand.
const TEST_PREFIX = '_migration-checks';
const BODY = `iece r2 verification ${new Date().toISOString()}`;

const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (error) {
    failures += 1;
    results.push({ name, ok: false, detail: error.message });
  }
}

/** fetch() that never throws, so a network refusal is a result rather than a crash. */
async function tryFetch(url, options) {
  try {
    const res = await fetch(url, options);
    return { ok: true, status: res.status, headers: res.headers, res };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function main() {
  let cfg;
  try {
    cfg = r2Config();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n  Configuration problem\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log('\n  R2 VERIFICATION');
  console.log(`  account   ${cfg.accountId.slice(0, 6)}…${cfg.accountId.slice(-4)}`);
  console.log(`  public    ${cfg.bucketPublic}  →  ${cfg.publicBaseUrl}`);
  console.log(`  private   ${cfg.bucketPrivate}  →  signed URLs, ${cfg.signedTtl}s\n`);

  if (cfg.isDevUrl) {
    console.log(
      '  NOTE  R2_PUBLIC_BASE_URL is still an r2.dev development URL.\n'
      + '        Fine for these checks, but it must be the custom domain before Phase 5\n'
      + '        writes any URL into MongoDB.\n'
    );
  }

  const client = makeClient(cfg);
  const stamp = `${Date.now()}-${process.pid}`;
  const publicKey = `${TEST_PREFIX}/public-${stamp}.txt`;
  const privateKey = `${TEST_PREFIX}/private-${stamp}.txt`;

  try {
    // ---- token scope -----------------------------------------------------
    await check('API token can read the public bucket', async () => {
      await probeBucket(client, cfg.bucketPublic);
      return cfg.bucketPublic;
    });

    await check('API token can read the private bucket', async () => {
      await probeBucket(client, cfg.bucketPrivate);
      return cfg.bucketPrivate;
    });

    // ---- public bucket ---------------------------------------------------
    await check('Write an object to the public bucket', async () => {
      await putObject(client, {
        bucket: cfg.bucketPublic,
        key: publicKey,
        body: BODY,
        contentType: 'text/plain; charset=utf-8',
        // Never cache a throwaway. A year-long immutable cache on a file we are
        // about to delete would make the "it is gone" check below meaningless.
        cacheControl: 'no-store',
      });
      return publicKey;
    });

    await check('Stored Content-Type survives the round trip', async () => {
      const head = await headObject(client, cfg.bucketPublic, publicKey);
      if (!head) throw new Error('object not found immediately after writing it');
      if (!String(head.ContentType).startsWith('text/plain')) {
        throw new Error(`expected text/plain, R2 reports "${head.ContentType}"`);
      }
      return head.ContentType;
    });

    await check(`Custom domain serves the object (${new URL(cfg.publicBaseUrl).host})`, async () => {
      const url = `${cfg.publicBaseUrl}/${publicKey}`;
      const r = await tryFetch(url);
      if (!r.ok) throw new Error(`could not reach ${url} — ${r.error}`);
      if (r.status === 404) {
        throw new Error(
          `${url} answered 404. The domain resolves but is not connected to `
          + `"${cfg.bucketPublic}" — check Bucket → Settings → Custom Domains.`
        );
      }
      if (r.status === 401 || r.status === 403) {
        throw new Error(`${url} answered ${r.status}. The bucket is not publicly readable.`);
      }
      if (r.status !== 200) throw new Error(`${url} answered ${r.status}`);

      const text = await r.res.text();
      if (text !== BODY) throw new Error('the bytes served back do not match what was written');

      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('text/plain')) {
        throw new Error(`served with Content-Type "${ct}" instead of text/plain`);
      }
      return `200, ${text.length} bytes, ${ct}`;
    });

    await check('Range requests work (expo-video needs these to seek)', async () => {
      const url = `${cfg.publicBaseUrl}/${publicKey}`;
      const r = await tryFetch(url, { headers: { Range: 'bytes=0-3' } });
      if (!r.ok) throw new Error(r.error);
      if (r.status !== 206) {
        throw new Error(`expected 206 Partial Content, got ${r.status} — video seeking will not work`);
      }
      const text = await r.res.text();
      if (text !== BODY.slice(0, 4)) throw new Error(`range returned "${text}"`);
      return '206 Partial Content';
    });

    // ---- private bucket --------------------------------------------------
    await check('Write an object to the private bucket', async () => {
      await putObject(client, {
        bucket: cfg.bucketPrivate,
        key: privateKey,
        body: BODY,
        contentType: 'text/plain; charset=utf-8',
        cacheControl: 'no-store',
      });
      return privateKey;
    });

    await check('A signed URL reads the private object', async () => {
      const url = await signGetUrl(client, cfg.bucketPrivate, privateKey, cfg.signedTtl);
      const r = await tryFetch(url);
      if (!r.ok) throw new Error(r.error);
      if (r.status !== 200) throw new Error(`signed URL answered ${r.status}`);
      const text = await r.res.text();
      if (text !== BODY) throw new Error('signed URL served the wrong bytes');
      return `200, expires in ${cfg.signedTtl}s`;
    });

    await check('WITHOUT a signature the private object is refused', async () => {
      const url = `${cfg.endpoint}/${cfg.bucketPrivate}/${privateKey}`;
      const r = await tryFetch(url);
      if (!r.ok) throw new Error(r.error);
      if (r.status === 200) {
        throw new Error(
          'the private bucket served an unsigned request. Face recordings would be '
          + 'publicly readable — check that public access is disabled on '
          + `"${cfg.bucketPrivate}".`
        );
      }
      return `refused with ${r.status}`;
    });

    await check('The public domain does not expose the private bucket', async () => {
      const url = `${cfg.publicBaseUrl}/${privateKey}`;
      const r = await tryFetch(url);
      if (!r.ok) throw new Error(r.error);
      if (r.status === 200) {
        throw new Error(
          `${new URL(cfg.publicBaseUrl).host} served an object from the private bucket. `
          + 'The custom domain is attached to the wrong bucket.'
        );
      }
      return `${r.status} as expected`;
    });

    // ---- deletion --------------------------------------------------------
    await check('Delete removes the object, and it is provably gone', async () => {
      await deleteObject(client, cfg.bucketPublic, publicKey);
      const head = await headObject(client, cfg.bucketPublic, publicKey);
      if (head) throw new Error('delete reported success but the object is still there');
      return 'HEAD answers 404';
    });
  } finally {
    // Whatever happened above, do not leave test objects behind. Failures here
    // are reported but never mask the real result.
    for (const [bucket, key] of [[cfg.bucketPublic, publicKey], [cfg.bucketPrivate, privateKey]]) {
      try {
        await deleteObject(client, bucket, key);
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404) {
          console.warn(`  cleanup: could not remove ${bucket}/${key} — ${error.message}`);
        }
      }
    }
  }

  // ---- report ------------------------------------------------------------
  console.log('');
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${r.name.padEnd(width)}   ${r.detail}`);
  }

  console.log('');
  if (failures === 0) {
    console.log(`  All ${results.length} checks passed. R2 is ready for Phase 2.\n`);
    process.exit(0);
  }
  console.log(`  ${failures} of ${results.length} checks failed. Fix these before Phase 2.\n`);
  process.exit(1);
}

main().catch((error) => {
  console.error('\n  Unexpected failure:\n');
  console.error(error);
  process.exit(1);
});
