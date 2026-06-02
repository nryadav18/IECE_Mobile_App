const express = require('express');
const {
  getActivities,
  createActivity,
  submitActivity,
  approveSchoolActivity,
  confirmAdminActivity,
  sendBackActivity
} = require('../controllers/activityController');

// If you have authentication middleware (like protect and authorize), they should be added here.
// Example: const { protect, authorize } = require('../middleware/auth');
// For now, setting up basic routes.
const router = express.Router();

router.route('/')
  .get(getActivities)
  .post(createActivity);

router.put('/:id/submit', submitActivity);
router.put('/:id/approve-school', approveSchoolActivity);
router.put('/:id/confirm-admin', confirmAdminActivity);
router.put('/:id/send-back', sendBackActivity);

module.exports = router;
