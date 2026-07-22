const express = require('express');
const {
  getTeamLeaders,
  getSchools,
  createTeamLeader,
  createChairmanAndSchool,
  createTrainer,
  createHead,
  createTeam,
  getTeams,
  deleteTeam,
  getUsersPaginated,
  updateUser,
  deleteUser,
  getPendingFacialRegistrations,
  approveFacialRegistration,
  deleteFacialRegistration
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { HEAD_ROLES, LEADER_ROLES } = require('../utils/roles');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Allow creator_admin, (trainee) team leaders, trainer and heads to view users.
// Heads use this to list the members of a team; leaders to list their trainers.
router.get(
  '/users',
  authorize('creator_admin', ...LEADER_ROLES, 'trainer', ...HEAD_ROLES),
  getUsersPaginated
);

// Teams: admin manages them; heads may list the ones assigned to them.
router.get('/teams', authorize('creator_admin', ...HEAD_ROLES), getTeams);
router.post('/team', authorize('creator_admin'), createTeam);
router.delete('/team/:id', authorize('creator_admin'), deleteTeam);

// Restrict everything else to creator_admin
router.get('/team-leaders', authorize('creator_admin'), getTeamLeaders);
router.get('/schools', authorize('creator_admin'), getSchools);

router.post('/team-leader', authorize('creator_admin'), createTeamLeader);
router.post('/chairman-school', authorize('creator_admin'), createChairmanAndSchool);
router.post('/trainer', authorize('creator_admin'), createTrainer);
router.post('/head', authorize('creator_admin'), createHead);

router.put('/user/:id', authorize('creator_admin'), updateUser);
router.delete('/user/:id', authorize('creator_admin'), deleteUser);

router.get('/pending-face-registrations', authorize('creator_admin'), getPendingFacialRegistrations);
router.put('/approve-face-registration/:id', authorize('creator_admin'), approveFacialRegistration);
router.delete('/face-registration/:id', authorize('creator_admin'), deleteFacialRegistration);

module.exports = router;
