const express = require('express');
const {
  getPendingFaceRegistrations,
  reviewFaceRegistration,
  getPendingActivities,
} = require('../controllers/approvalController');
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES, HEAD_ROLES, ADMIN_ROLES, FACE_APPROVERS } = require('../utils/roles');

const router = express.Router();

// Only people who can ever BE an approver reach these routes at all; the
// controller then narrows each request to the specific people that approver is
// actually responsible for.
const APPROVERS = [...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES];

router.use(protect, authorize(...APPROVERS));

// Facial registrations are the Admin's alone — see FACE_APPROVERS. Activities
// stay with whoever sits above the uploader, so the two queues no longer share
// an audience even though they still share a screen.
router.get('/face', authorize(...FACE_APPROVERS), getPendingFaceRegistrations);
router.put('/face/:userId/:schoolId', authorize(...FACE_APPROVERS), reviewFaceRegistration);

router.get('/activities', getPendingActivities);

module.exports = router;
