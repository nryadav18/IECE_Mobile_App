const express = require('express');
const {
  getActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  updateActivityStatus,
  toggleStarActivity
} = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');
const { FIELD_STAFF, HEAD_ROLES } = require('../utils/roles');

const router = express.Router();

router.route('/')
  .get(protect, getActivities)
  .post(protect, authorize(...FIELD_STAFF, 'creator_admin'), createActivity);

router.route('/:id')
  .get(protect, getActivityById)
  .put(protect, authorize(...FIELD_STAFF, 'creator_admin'), updateActivity)
  .delete(protect, authorize(...FIELD_STAFF, 'creator_admin'), deleteActivity);

router.route('/:id/status')
  .put(protect, authorize('chairman', 'creator_admin'), updateActivityStatus);

// Only heads (and admin) may star / unstar an activity.
router.route('/:id/star')
  .put(protect, authorize(...HEAD_ROLES, 'creator_admin'), toggleStarActivity);

module.exports = router;
