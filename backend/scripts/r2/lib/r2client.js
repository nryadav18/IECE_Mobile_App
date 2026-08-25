const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ---------------------------------------------------------------------------
// R2 SPEAKS S3, WITH THREE DIFFERENCES THAT MATTER.
//
//   1. `region` must be the literal string 'auto'. R2 has no regions in the S3
//      sense; the SDK simply refuses to build a request without one.
//   2. The endpoint is per-account, and the account id is IN it. Point it at
//      the wrong account and every call still succeeds — against storage that
//      is not yours.
//   3. Checksum behaviour: newer AWS SDK versions add integrity headers that
//      some S3-compatible services reject. R2 accepts the standard ones, so the
//      defaults are left alone here rather than disabled on a guess — if an
//      upload ever fails with an unexpected checksum error, that is where to
//      look first.
// ---------------------------------------------------------------------------

function makeClient(cfg) {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/**
 * Put one object.
 *
 * `contentType` is mandatory on purpose. Cloudinary derived it from the asset;
 * R2 stores exactly what it is told, and an object served as
 * `application/octet-stream` is a video that will not play and a PDF that
 * downloads as junk. Making it a required argument means the mistake cannot be
 * made by omission.
 */
async function putObject(client, { bucket, key, body, contentType, cacheControl, metadata }) {
  if (!contentType) throw new Error(`putObject: contentType is required (key: ${key})`);
  return client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Every key this migration produces is unique — a timestamped public_id, or
    // a derivative of one — so nothing at a given key ever changes. That makes
    // an immutable year-long cache correct rather than merely convenient.
    CacheControl: cacheControl || 'public, max-age=31536000, immutable',
    Metadata: metadata,
  }));
}

/** HEAD an object. Returns null for 404 rather than throwing, since "not there" is an answer. */
async function headObject(client, bucket, key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

async function deleteObject(client, bucket, key) {
  return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Fetch an object's bytes through the S3 API (used to prove a private object is readable). */
async function getObjectBytes(client, bucket, key) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

/** A time-limited HTTPS URL for one private object. */
async function signGetUrl(client, bucket, key, expiresIn) {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** Does this bucket exist and can the token see into it? Cheap, and a clear failure. */
async function probeBucket(client, bucket) {
  await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
}

module.exports = {
  makeClient,
  putObject,
  headObject,
  deleteObject,
  getObjectBytes,
  signGetUrl,
  probeBucket,
};
