const express = require('express');
const {
  applyLeave,
  getLeaveRequests,
  getLeaveRequest,
  approveLeave,
  rejectLeave,
  cancelLeave,
} = require('../controllers/leaveController');
const { protect, authorize } = require('../middleware/auth');
const { LEAVE_APPLICANTS, LEAVE_APPROVERS } = require('../utils/roles');

const router = express.Router();

// Applicants (all field staff) + the Admin (approver) may read the list/detail.
const READERS = [...LEAVE_APPLICANTS, ...LEAVE_APPROVERS];

// Requests
router.route('/')
  .get(protect, authorize(...READERS), getLeaveRequests)
  .post(protect, authorize(...LEAVE_APPLICANTS), applyLeave);

router.get('/:id', protect, authorize(...READERS), getLeaveRequest);
router.post('/:id/approve', protect, authorize(...LEAVE_APPROVERS), approveLeave);
router.post('/:id/reject', protect, authorize(...LEAVE_APPROVERS), rejectLeave);
router.post('/:id/cancel', protect, authorize(...READERS), cancelLeave);

module.exports = router;
