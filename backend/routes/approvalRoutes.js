const express = require('express');
const {
  getPendingFaceRegistrations,
  reviewFaceRegistration,
  getPendingActivities,
} = require('../controllers/approvalController');
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES, HEAD_ROLES, ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// Only people who can ever BE an approver reach these routes at all; the
// controller then narrows each request to the specific people that approver is
// actually responsible for.
const APPROVERS = [...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES];

router.use(protect, authorize(...APPROVERS));

router.get('/face', getPendingFaceRegistrations);
router.put('/face/:userId/:schoolId', reviewFaceRegistration);

router.get('/activities', getPendingActivities);

module.exports = router;
