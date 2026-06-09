const express = require('express');
const { 
  getActivities, 
  getActivityById, 
  createActivity, 
  updateActivity, 
  deleteActivity,
  updateActivityStatus 
} = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getActivities)
  .post(protect, authorize('trainer', 'team_leader', 'creator_admin'), createActivity);

router.route('/:id')
  .get(protect, getActivityById)
  .put(protect, authorize('trainer', 'team_leader', 'creator_admin'), updateActivity)
  .delete(protect, authorize('trainer', 'team_leader', 'creator_admin'), deleteActivity);

router.route('/:id/status')
  .put(protect, authorize('chairman'), updateActivityStatus);

module.exports = router;
