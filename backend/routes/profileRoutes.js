const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getUserProfile,
  getAssignedTrainersProfiles
} = require('../controllers/profileController');

router.get('/team-leader/trainers', protect, authorize('team_leader', 'creator_admin'), getAssignedTrainersProfiles);
router.get('/:id', protect, getUserProfile);

module.exports = router;
