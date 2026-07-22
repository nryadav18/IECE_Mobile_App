const express = require('express');
const {
  getReports,
  createReport,
  updateReport,
  deleteReport,
  updateReportStatus,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES, HEAD_ROLES } = require('../utils/roles');

const router = express.Router();

router.route('/')
  .get(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES, 'chairman', 'creator_admin'), getReports)
  .post(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES), createReport);

router.route('/:id/status')
  .put(protect, authorize('chairman'), updateReportStatus);

router.route('/:id')
  .put(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES, 'chairman'), updateReport)
  .delete(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES), deleteReport);

module.exports = router;
