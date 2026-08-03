const express = require('express');
const {
  getTeamLeaders,
  getSchools,
  getArchivedSchools,
  restoreSchool,
  createTeamLeader,
  createChairmanAndSchool,
  createTrainer,
  createHead,
  createTeam,
  getTeams,
  getTeamById,
  deleteTeam,
  getUsersPaginated,
  updateUser,
  deleteUser,
  getPendingFacialRegistrations,
  approveFacialRegistration,
  deleteFacialRegistration,
  initiateAdminCreation,
  verifyAndCreateAdmin,
  resendAdminOtps
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES } = require('../utils/roles');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Allow admins/CEO, (trainee) team leaders, trainer and heads to view users.
// Heads use this to list team members; leaders their trainers; CEO views all.
router.get(
  '/users',
  authorize(...ADMIN_ROLES, ...LEADER_ROLES, 'trainer', ...HEAD_ROLES),
  getUsersPaginated
);

// Teams: admin manages them; heads/CEO may list them (read-only for CEO).
router.get('/teams', authorize(...ADMIN_ROLES, ...HEAD_ROLES), getTeams);
router.post('/team', authorize('creator_admin'), createTeam);
// Drill-in on a single team (its members, heads and school coverage).
router.get('/team/:id', authorize(...ADMIN_ROLES, ...HEAD_ROLES), getTeamById);
router.delete('/team/:id', authorize('creator_admin'), deleteTeam);

// Read lists: admin + CEO. Creation stays admin-only below.
router.get('/team-leaders', authorize(...ADMIN_ROLES), getTeamLeaders);
router.get('/schools', authorize(...ADMIN_ROLES), getSchools);
// Archived schools: deleting a school login never destroys the work done there,
// so the school itself is kept (hidden) and can be brought back.
router.get('/schools/archived', authorize(...ADMIN_ROLES), getArchivedSchools);
router.put('/school/:id/restore', authorize('creator_admin'), restoreSchool);

router.post('/team-leader', authorize('creator_admin'), createTeamLeader);
router.post('/chairman-school', authorize('creator_admin'), createChairmanAndSchool);
router.post('/trainer', authorize('creator_admin'), createTrainer);
router.post('/head', authorize('creator_admin'), createHead);

router.put('/user/:id', authorize('creator_admin'), updateUser);
router.delete('/user/:id', authorize('creator_admin'), deleteUser);

// Create Admin — dual-OTP verified (existing admin + new admin emails).
router.post('/create-admin/initiate', authorize('creator_admin'), initiateAdminCreation);
router.post('/create-admin/verify', authorize('creator_admin'), verifyAndCreateAdmin);
router.post('/create-admin/resend', authorize('creator_admin'), resendAdminOtps);

router.get('/pending-face-registrations', authorize('creator_admin'), getPendingFacialRegistrations);
router.put('/approve-face-registration/:id/:schoolId', authorize('creator_admin'), approveFacialRegistration);
router.delete('/face-registration/:id/:schoolId', authorize('creator_admin'), deleteFacialRegistration);

module.exports = router;
