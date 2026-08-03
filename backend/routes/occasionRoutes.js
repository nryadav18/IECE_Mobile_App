const express = require('express');
const {
  listOccasions,
  upsertOccasion,
  deleteOccasion,
} = require('../controllers/occasionController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.route('/')
  // Open to every authenticated role: the celebration header is on the home
  // screen, which everyone sees. Same reasoning as /api/stats/overview.
  .get(listOccasions)
  // Writes follow the adminRoutes convention — CEO reads, creator_admin writes.
  .post(authorize('creator_admin'), upsertOccasion);

router.delete('/:key', authorize('creator_admin'), deleteOccasion);

module.exports = router;
