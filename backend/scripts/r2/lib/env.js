const path = require('path');

// These scripts live three levels below backend/, and they are run from wherever
// the operator happens to be standing. Resolving the .env explicitly rather than
// relying on the working directory is what stops "the script says my credentials
// are missing" from being the first thing that happens on a fresh machine.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// ---------------------------------------------------------------------------
// ONE PLACE THAT KNOWS WHAT A COMPLETE CONFIGURATION LOOKS LIKE.
//
// Every migration script asks for its configuration here and fails immediately
// if something is missing or malformed, rather than discovering it half way
// through a run against a live account. A copy job that dies at file 4,000
// because a variable was empty is recoverable; one that quietly wrote 4,000
// files to the wrong bucket is not.
// ---------------------------------------------------------------------------

/** A value that is present and not just whitespace. */
const has = (v) => typeof v === 'string' && v.trim().length > 0;

class ConfigError extends Error {}

/**
 * Everything the R2 side needs, validated.
 *
 * The checks are deliberately stricter than "is it set". An account id of the
 * wrong length, or an endpoint pointing at a different account than the id,
 * are both configurations that authenticate fine and then operate on somebody
 * else's storage — so they are caught here rather than trusted.
 */
function r2Config({ requireCustomDomain = false } = {}) {
  const problems = [];

  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = (process.env.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
  const bucketPublic = (process.env.R2_BUCKET_PUBLIC || '').trim();
  const bucketPrivate = (process.env.R2_BUCKET_PRIVATE || '').trim();
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const signedTtl = Number(process.env.R2_SIGNED_URL_TTL || 900);

  if (!has(accountId)) problems.push('R2_ACCOUNT_ID is missing.');
  else if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    problems.push(`R2_ACCOUNT_ID should be 32 hex characters; got ${accountId.length}.`);
  }

  if (!has(accessKeyId)) problems.push('R2_ACCESS_KEY_ID is missing.');
  if (!has(secretAccessKey)) problems.push('R2_SECRET_ACCESS_KEY is missing.');
  if (!has(bucketPublic)) problems.push('R2_BUCKET_PUBLIC is missing.');
  if (!has(bucketPrivate)) problems.push('R2_BUCKET_PRIVATE is missing.');

  if (!has(endpoint)) {
    problems.push('R2_ENDPOINT is missing.');
  } else if (has(accountId) && !endpoint.includes(accountId)) {
    // The endpoint carries the account id. If the two disagree, one of them was
    // pasted from a different account — and the request would succeed against
    // whichever one the endpoint names.
    problems.push('R2_ENDPOINT does not contain R2_ACCOUNT_ID — they are from different accounts.');
  }

  if (bucketPublic && bucketPrivate && bucketPublic === bucketPrivate) {
    // The whole point of the private bucket is that face recordings are not
    // reachable over the public domain. One bucket for both defeats it silently.
    problems.push('R2_BUCKET_PUBLIC and R2_BUCKET_PRIVATE must be different buckets.');
  }

  if (!has(publicBaseUrl)) {
    problems.push('R2_PUBLIC_BASE_URL is missing.');
  } else if (!/^https:\/\//i.test(publicBaseUrl)) {
    problems.push('R2_PUBLIC_BASE_URL must start with https://');
  }

  const isDevUrl = /\.r2\.dev$/i.test(publicBaseUrl.replace(/^https?:\/\//, ''));
  if (requireCustomDomain && isDevUrl) {
    // Whatever is in this variable is what gets written into MongoDB. A
    // rate-limited development hostname baked into every record is a second
    // migration nobody asked for.
    problems.push(
      'R2_PUBLIC_BASE_URL is still the r2.dev development URL. This value is written into '
      + 'the database, so it must be the custom domain before any URL is stored.'
    );
  }

  if (!Number.isFinite(signedTtl) || signedTtl < 60 || signedTtl > 604800) {
    problems.push('R2_SIGNED_URL_TTL must be a number of seconds between 60 and 604800.');
  }

  if (problems.length) {
    throw new ConfigError(
      `backend/.env is not ready:\n  - ${problems.join('\n  - ')}\n\n`
      + 'See docs/r2-migration-runbook.md section 3.4 for the full list of variables.'
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucketPublic,
    bucketPrivate,
    publicBaseUrl,
    signedTtl,
    isDevUrl,
  };
}

/** Cloudinary credentials — read-only use in these scripts, but still required. */
function cloudinaryConfig() {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

  if (!has(cloudName) || !has(apiKey) || !has(apiSecret)) {
    throw new ConfigError(
      'CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET must all be set.\n'
      + 'Keep these until the migration is complete — they are how the old files are read '
      + 'and how a rollback works.'
    );
  }
  return { cloudName, apiKey, apiSecret };
}

function mongoUri() {
  const uri = (process.env.MONGO_URI || '').trim();
  if (!has(uri)) throw new ConfigError('MONGO_URI is missing from backend/.env');
  return uri;
}

module.exports = { r2Config, cloudinaryConfig, mongoUri, ConfigError };
