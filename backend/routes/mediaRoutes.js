const express = require('express');
const { getMedia, createMedia, updateMedia, updateMediaStatus, deleteMedia } = require('../controllers/mediaController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getMedia)
  .post(protect, authorize('team_leader', 'creator_admin'), createMedia);

router.route('/:id')
  // Editing the description / "Invisible to" audience of a live banner.
  .put(protect, authorize('creator_admin'), updateMedia)
  .delete(protect, authorize('creator_admin'), deleteMedia);

router.route('/:id/status')
  .put(protect, authorize('chairman'), updateMediaStatus);

module.exports = router;
