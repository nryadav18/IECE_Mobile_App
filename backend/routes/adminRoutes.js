const express = require('express');
const {
  getTeamLeaders,
  getSchools,
  createTeamLeader,
  createChairmanAndSchool,
  createTrainer,
  getUsersPaginated,
  updateUser,
  deleteUser
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Allow creator_admin, team_leader, trainer to view users
router.get('/users', authorize('creator_admin', 'team_leader', 'trainer'), getUsersPaginated);

// Restrict everything else to creator_admin
router.get('/team-leaders', authorize('creator_admin'), getTeamLeaders);
router.get('/schools', authorize('creator_admin'), getSchools);

router.post('/team-leader', authorize('creator_admin'), createTeamLeader);
router.post('/chairman-school', authorize('creator_admin'), createChairmanAndSchool);
router.post('/trainer', authorize('creator_admin'), createTrainer);

router.put('/user/:id', authorize('creator_admin'), updateUser);
router.delete('/user/:id', authorize('creator_admin'), deleteUser);

module.exports = router;
