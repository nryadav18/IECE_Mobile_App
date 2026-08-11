const express = require('express');
const {
  getApprovalLog,
  getApprovers,
  getEntityTrail,
  getApprovalSummary,
} = require('../controllers/approvalLogController');
const { protect, authorize } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// The whole log is Admin + CEO. Guarded here AND in every handler — this is the
// one collection that holds the organisation's entire decision history, so it
// does not rely on a single check.
router.use(protect, authorize(...ADMIN_ROLES));

// Static paths first: '/summary' and '/approvers' would otherwise be swallowed
// by the '/:entityType/:entityId' pattern below.
router.get('/summary', getApprovalSummary);
router.get('/approvers', getApprovers);
router.get('/', getApprovalLog);
router.get('/:entityType/:entityId', getEntityTrail);

module.exports = router;
