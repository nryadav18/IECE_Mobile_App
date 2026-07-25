const express = require('express');
const {
  getRecipients,
  createMeeting,
  getMeetings,
  deleteMeeting,
} = require('../controllers/meetingController');
const { protect, authorize } = require('../middleware/auth');
const { MEETING_CREATORS, MEETING_VIEWERS } = require('../utils/roles');

const router = express.Router();

// Recipient picker + posting are for creators (leaders/heads/CEO/Admin).
router.get('/recipients', protect, authorize(...MEETING_CREATORS), getRecipients);

router.route('/')
  .get(protect, authorize(...MEETING_VIEWERS), getMeetings)
  .post(protect, authorize(...MEETING_CREATORS), createMeeting);

router.delete('/:id', protect, authorize(...MEETING_CREATORS), deleteMeeting);

module.exports = router;
