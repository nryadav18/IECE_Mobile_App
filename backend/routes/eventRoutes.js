const express = require('express');
const { getEvents, getEventById, createEvent, updateEvent, deleteEvent } = require('../controllers/eventController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getEvents)
  .post(protect, authorize('trainer', 'team_leader', 'creator_admin'), createEvent);

router.route('/:id')
  .get(protect, getEventById)
  .put(protect, authorize('trainer', 'team_leader', 'creator_admin'), updateEvent)
  .delete(protect, authorize('trainer', 'team_leader', 'creator_admin'), deleteEvent);

module.exports = router;
