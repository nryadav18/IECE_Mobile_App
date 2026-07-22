const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { LEADER_ROLES } = require('../utils/roles');
const {
  getUserProfile,
  getAssignedTrainersProfiles
} = require('../controllers/profileController');

router.get('/team-leader/trainers', protect, authorize(...LEADER_ROLES, 'creator_admin'), getAssignedTrainersProfiles);
router.get('/:id', protect, getUserProfile);

module.exports = router;
