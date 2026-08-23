const express = require('express');
const {
  getActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  deleteActivityMedia,
  updateActivityStatus,
  toggleStarActivity
} = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');
const { FIELD_STAFF, HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

router.route('/')
  .get(protect, getActivities)
  .post(protect, authorize(...FIELD_STAFF, 'creator_admin'), createActivity);

router.route('/:id')
  .get(protect, getActivityById)
  .put(protect, authorize(...FIELD_STAFF, 'creator_admin'), updateActivity)
  .delete(protect, authorize(...FIELD_STAFF, 'creator_admin'), deleteActivity);

// Approving an activity now follows the staff chain of command rather than the
// school login: a trainer's activity is decided by their team leader, a
// leader's by their head, a head's by Admin/CEO. The controller narrows this to
// the specific uploader each approver is responsible for. The chairman is still
// told when an activity at their school is approved, but no longer decides it.
router.route('/:id/status')
  .put(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES), updateActivityStatus);

// Strip an activity's photos and videos out of Cloudinary while keeping the
// activity itself. The Admin alone: see deleteActivityMedia for why.
router.route('/:id/media')
  .delete(protect, authorize('creator_admin'), deleteActivityMedia);

// Only heads (and admin) may star / unstar an activity.
router.route('/:id/star')
  .put(protect, authorize(...HEAD_ROLES, 'creator_admin'), toggleStarActivity);

module.exports = router;
