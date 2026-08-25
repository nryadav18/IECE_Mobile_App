const crypto = require('crypto');

// ---------------------------------------------------------------------------
// SIGNING A PRIVATE URL, SYNCHRONOUSLY.
//
// Face recordings live in a private bucket and are handed to the Admin as
// short-lived signed URLs. The signing happens in middleware/signedAssets.js,
// which wraps res.json — and res.json is SYNCHRONOUS. The AWS SDK's presigner
// returns a Promise, so using it there would mean turning res.json into an
// async function for every response the app sends, on every route. That is a
// large, invisible change to request timing in exchange for a signature, and
// the failure modes (a response that resolves after the socket closed, an
// error thrown outside any handler) are exactly the kind that show up in
// production and nowhere else.
//
// SigV4 is deterministic HMAC arithmetic. There is nothing asynchronous about
// it — the SDK is async only because it also resolves credentials and region.
// Both are already known here. So it is implemented directly, and proven
// against the real bucket rather than assumed correct.
// ---------------------------------------------------------------------------

const ALGORITHM = 'AWS4-HMAC-SHA256';

// R2 has no regions in the S3 sense, but SigV4 requires one in the credential
// scope and the signature will not verify if it disagrees with what the server
// expects. Cloudflare's is the literal string 'auto'.
const REGION = 'auto';
const SERVICE = 's3';

/**
 * Percent-encode per RFC 3986, which is stricter than encodeURIComponent.
 *
 * encodeURIComponent leaves ! ' ( ) * alone; AWS requires them encoded, and a
 * single character of disagreement produces a signature that verifies against
 * nothing. Iterating the UTF-8 bytes rather than the characters is what makes
 * non-ASCII filenames sign correctly.
 */
function uriEncode(value, encodeSlash = true) {
  let out = '';
  for (const byte of Buffer.from(String(value), 'utf8')) {
    const ch = String.fromCharCode(byte);
    if ((byte >= 0x41 && byte <= 0x5a)      // A-Z
      || (byte >= 0x61 && byte <= 0x7a)     // a-z
      || (byte >= 0x30 && byte <= 0x39)     // 0-9
      || ch === '-' || ch === '_' || ch === '.' || ch === '~') {
      out += ch;
    } else if (ch === '/' && !encodeSlash) {
      out += ch;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');

/** YYYYMMDDTHHMMSSZ and YYYYMMDD, which is the only date format SigV4 accepts. */
function stamps(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * A presigned GET URL for one private object.
 *
 * `bucketTime` is deliberately rounded DOWN to a five-minute boundary rather
 * than being "now". Two responses a few seconds apart would otherwise carry two
 * different URLs for the same video, and a React re-render would throw away a
 * partly-buffered download and start again — visible as a video that restarts
 * itself while the Admin is watching it. Rounding makes the URL stable within
 * the window, so the player and the HTTP cache both keep working, and the
 * expiry is extended by the same window so a URL minted at the end of a bucket
 * still has its full lifetime.
 */
function presignGetUrl({
  accessKeyId,
  secretAccessKey,
  endpoint,
  bucket,
  key,
  expiresIn = 900,
  now = new Date(),
  bucketSeconds = 300,
}) {
  if (!accessKeyId || !secretAccessKey) throw new Error('presignGetUrl: credentials are required');
  if (!bucket || !key) throw new Error('presignGetUrl: bucket and key are required');

  const rounded = new Date(Math.floor(now.getTime() / (bucketSeconds * 1000)) * bucketSeconds * 1000);
  const { amzDate, dateStamp } = stamps(rounded);
  const host = new URL(endpoint).host;
  const canonicalUri = `/${uriEncode(bucket)}/${uriEncode(key, false)}`;
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  // Must be sorted by parameter name. These five happen to already be in order,
  // but the sort is explicit so adding one later cannot silently break signing.
  const params = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn + bucketSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request'
  );
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `${endpoint.replace(/\/+$/, '')}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

module.exports = { presignGetUrl, uriEncode };
