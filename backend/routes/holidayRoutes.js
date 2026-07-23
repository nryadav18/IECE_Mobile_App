const express = require('express');
const {
  applyHoliday,
  getHolidays,
  reviewHoliday,
  deleteHoliday,
} = require('../controllers/holidayController');
const { protect, authorize } = require('../middleware/auth');
const { FIELD_STAFF } = require('../utils/roles');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getHolidays)
  .post(authorize(...FIELD_STAFF), applyHoliday);

router.put('/:id/status', authorize('creator_admin'), reviewHoliday);
router.delete('/:id', deleteHoliday);

module.exports = router;
