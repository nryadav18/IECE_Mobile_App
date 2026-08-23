const express = require('express');
const router = express.Router();
const { getLive } = require('../controllers/monitoringController');
const { protect, authorize } = require('../middleware/auth');
const { MONITORING_VIEWERS } = require('../utils/roles');

// The live dashboard. Admin and CEO see the whole organisation; heads see the
// teams assigned to them and (trainee) team leaders see the trainers working
// under them. The role check here is only the door — the controller scopes the
// PAYLOAD itself (see utils/monitoringScope.js), so passing this middleware
// never means seeing anybody outside your own hierarchy.
router.get('/live', protect, authorize(...MONITORING_VIEWERS), getLive);

module.exports = router;
