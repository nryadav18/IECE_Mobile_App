const express = require('express');
const {
  applyHoliday,
  getHolidays,
  reviewHoliday,
  deleteHoliday,
} = require('../controllers/holidayController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getHolidays)
  .post(authorize('trainer', 'team_leader'), applyHoliday);

router.put('/:id/status', authorize('chairman', 'creator_admin'), reviewHoliday);
router.delete('/:id', deleteHoliday);

module.exports = router;
