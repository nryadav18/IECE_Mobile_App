const express = require('express');
const {
  getReports,
  createReport,
  updateReport,
  deleteReport,
  updateReportStatus,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES, HEAD_ROLES, ADMIN_ROLES, REPORT_AUTHORS } = require('../utils/roles');

const router = express.Router();

router.route('/')
  .get(protect, authorize(...LEADER_ROLES, ...HEAD_ROLES, 'chairman', ...ADMIN_ROLES), getReports)
  .post(protect, authorize(...REPORT_AUTHORS), createReport);

router.route('/:id/status')
  .put(protect, authorize('chairman'), updateReportStatus);

router.route('/:id')
  .put(protect, authorize(...REPORT_AUTHORS, 'chairman'), updateReport)
  .delete(protect, authorize(...REPORT_AUTHORS), deleteReport);

module.exports = router;
