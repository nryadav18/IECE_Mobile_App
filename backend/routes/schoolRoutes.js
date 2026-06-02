const express = require('express');
const { getSchools, getSchool, createSchool, getFacultyRoster, uploadMou } = require('../controllers/schoolController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(getSchools)
  .post(protect, authorize('chairman'), createSchool);

router.route('/:id')
  .get(getSchool);

router.route('/:id/faculty')
  .get(protect, authorize('chairman', 'team_leader'), getFacultyRoster);

router.route('/:id/mou')
  .put(protect, authorize('creator_admin', 'team_leader'), uploadMou);

module.exports = router;
