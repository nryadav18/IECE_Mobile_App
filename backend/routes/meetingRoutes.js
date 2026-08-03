const express = require('express');
const {
  getRecipients,
  createMeeting,
  getMeetings,
  getMeeting,
  updateMeeting,
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

// Any viewer may open a meeting's detail; the controller enforces that it was
// actually shared with them. Editing / removing is restricted to creators, and
// the controller further narrows that to the owner or an Admin.
router.get('/:id', protect, authorize(...MEETING_VIEWERS), getMeeting);
router.put('/:id', protect, authorize(...MEETING_CREATORS), updateMeeting);
router.delete('/:id', protect, authorize(...MEETING_CREATORS), deleteMeeting);

module.exports = router;
