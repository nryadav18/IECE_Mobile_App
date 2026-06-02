const express = require('express');
const {
  getReports,
  createReport,
  updateReport,
  deleteReport,
  updateReportStatus,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, authorize('team_leader', 'chairman', 'creator_admin'), getReports)
  .post(protect, authorize('team_leader'), createReport);

router.route('/:id/status')
  .put(protect, authorize('chairman'), updateReportStatus);

router.route('/:id')
  .put(protect, authorize('team_leader'), updateReport)
  .delete(protect, authorize('team_leader'), deleteReport);

module.exports = router;
