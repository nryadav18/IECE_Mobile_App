// One-off migration to move from single-school to multi-school assignment and
// per-school facial registration.
//
// For every user it:
//   1. Seeds schoolIds = [schoolId] when schoolIds is empty and schoolId is set.
//   2. Folds the legacy V2 face registration (faceEmbeddingV2 +
//      registrationLocation + registrationPhotoUrl + facialRegistrationStatusV2)
//      into faceRegistrations[] as the entry for that user's school — but only
//      when the status is 'pending' or 'approved' and an embedding exists.
//
// The migration is idempotent: running it again will not duplicate entries.
//
//   node migrate_multi_school.js
//
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');
const User = require('./models/User');

dotenv.config();
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for multi-school migration...');

    const users = await User.find({});
    let schoolIdsSeeded = 0;
    let faceRegsSeeded = 0;

    for (const user of users) {
      let dirty = false;

      // 1. Seed schoolIds from the legacy single school.
      if ((!user.schoolIds || user.schoolIds.length === 0) && user.schoolId) {
        user.schoolIds = [user.schoolId];
        schoolIdsSeeded += 1;
        dirty = true;
      }

      // 2. Fold the legacy V2 face registration into faceRegistrations[].
      const legacyStatus = user.facialRegistrationStatusV2;
      const legacyEmbedding = user.faceEmbeddingV2;
      const anchorSchool = user.schoolId || (user.schoolIds && user.schoolIds[0]);

      const hasLegacyFace =
        (legacyStatus === 'approved' || legacyStatus === 'pending') &&
        Array.isArray(legacyEmbedding) &&
        legacyEmbedding.length > 0 &&
        anchorSchool;

      if (hasLegacyFace) {
        const already = (user.faceRegistrations || []).some(
          (fr) => String(fr.schoolId) === String(anchorSchool)
        );
        if (!already) {
          user.faceRegistrations.push({
            schoolId: anchorSchool,
            status: legacyStatus,
            faceEmbedding: legacyEmbedding,
            registrationLocation: user.registrationLocation || undefined,
            registrationPhotoUrl: user.registrationPhotoUrl || null
          });
          faceRegsSeeded += 1;
          dirty = true;
        }
      }

      if (dirty) {
        await user.save();
      }
    }

    console.log(`Migration complete. schoolIds seeded for ${schoolIdsSeeded} users; face registrations seeded for ${faceRegsSeeded} users.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
};

run();
