const express = require('express');
const {
  getVisitSchools,
  raiseVisit,
  getVisits,
  getVisit,
  approveVisit,
  rejectVisit,
  cancelVisit,
  updateVisitDates,
} = require('../controllers/schoolVisitController');
const { protect, authorize } = require('../middleware/auth');
const { SCHOOL_VISIT_APPLICANTS, SCHOOL_VISIT_APPROVERS } = require('../utils/roles');

const router = express.Router();

// Applicants (leaders + heads) + the Admin (approver) may read the list/detail.
const READERS = [...SCHOOL_VISIT_APPLICANTS, ...SCHOOL_VISIT_APPROVERS];

// School picker for the raise form.
router.get('/schools', protect, authorize(...READERS), getVisitSchools);

// Requests
router.route('/')
  .get(protect, authorize(...READERS), getVisits)
  .post(protect, authorize(...SCHOOL_VISIT_APPLICANTS), raiseVisit);

router.get('/:id', protect, authorize(...READERS), getVisit);
router.post('/:id/approve', protect, authorize(...SCHOOL_VISIT_APPROVERS), approveVisit);
// The Admin can move the window before OR after approval — both go through here.
router.post('/:id/dates', protect, authorize(...SCHOOL_VISIT_APPROVERS), updateVisitDates);
router.post('/:id/reject', protect, authorize(...SCHOOL_VISIT_APPROVERS), rejectVisit);
router.post('/:id/cancel', protect, authorize(...READERS), cancelVisit);

module.exports = router;
