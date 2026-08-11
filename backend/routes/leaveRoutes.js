const express = require('express');
const {
  applyLeave,
  getLeaveRequests,
  getLeaveRequest,
  getLeaveStaff,
  createEmergencyLeave,
  updateLeaveDates,
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

// Emergency leave — the Admin grants a leave FOR someone else. Declared before
// the '/:id' route so 'staff' is never swallowed as an id.
router.get('/staff', protect, authorize(...LEAVE_APPROVERS), getLeaveStaff);
router.post('/emergency', protect, authorize(...LEAVE_APPROVERS), createEmergencyLeave);

router.get('/:id', protect, authorize(...READERS), getLeaveRequest);
router.post('/:id/approve', protect, authorize(...LEAVE_APPROVERS), approveLeave);
router.post('/:id/reject', protect, authorize(...LEAVE_APPROVERS), rejectLeave);
// Changing the window, before or after approval — Admin only.
router.post('/:id/dates', protect, authorize(...LEAVE_APPROVERS), updateLeaveDates);
router.post('/:id/cancel', protect, authorize(...READERS), cancelLeave);

module.exports = router;
