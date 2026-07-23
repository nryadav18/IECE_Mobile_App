const express = require('express');
const {
  getSubjectStaff,
  getCandidateSubstitutes,
  raiseRequest,
  getRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
} = require('../controllers/substitutionController');
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES, HEAD_ROLES, ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// Everyone who can participate in the substitution flow (raisers + approvers).
const RAISERS = [...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES];

// Pickers
router.get('/staff', protect, authorize(...RAISERS), getSubjectStaff);
router.get('/candidates', protect, authorize(...ADMIN_ROLES), getCandidateSubstitutes);

// Requests
router.route('/')
  .get(protect, authorize(...RAISERS), getRequests)
  .post(protect, authorize(...RAISERS), raiseRequest);

router.get('/:id', protect, authorize(...RAISERS), getRequest);
router.post('/:id/approve', protect, authorize(...ADMIN_ROLES), approveRequest);
router.post('/:id/reject', protect, authorize(...ADMIN_ROLES), rejectRequest);
router.post('/:id/cancel', protect, authorize(...RAISERS), cancelRequest);

module.exports = router;
