const path = require('path');
const { URL_FIELDS, readField, projectionFor, filterFor, label } = require('./urlFields');

// ---------------------------------------------------------------------------
// EVERY URL THE DATABASE POINTS AT, AND EXACTLY WHERE FROM.
//
// Shared by the audit, the copy job, the verifier and the flip, so all four
// agree on what the scope is. Deriving it independently in four places is how
// a file ends up copied but never repointed, or repointed to something that was
// never copied.
//
// The direction matters: this reads OUTWARD FROM MONGO, never inward from a
// bucket listing. A Cloudinary folder does not correspond to a collection —
// POST /upload routes purely by MIME type, so `iece_images` feeds banners,
// activity photos and leave proofs alike — which makes the database the only
// trustworthy statement of what is actually in use.
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<Map<string, Array<{field, collectionName, recordId, index, bucket}>>>}
 *          distinct URL -> every place it is referenced from
 */
async function collectReferences(db, { onField } = {}) {
  const references = new Map();

  for (const spec of URL_FIELDS) {
    // Collection name from the model, not hard-coded, so a rename cannot make
    // this silently scan nothing and report "0 urls".
    const Model = require(path.join(__dirname, '..', '..', '..', 'models', spec.model));
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
          collectionName,
          recordId: String(doc._id),
          index,
          bucket: spec.bucket,
        });
      }
    }

    if (onField) onField({ field: fieldLabel, collectionName, documents: docs, urls });
  }

  return references;
}

const isCloudinaryUrl = (url) =>
  typeof url === 'string' && url.includes('cloudinary.com');

module.exports = { collectReferences, isCloudinaryUrl };
