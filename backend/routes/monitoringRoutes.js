const express = require('express');
const router = express.Router();
const { getLive } = require('../controllers/monitoringController');
const { protect, authorize } = require('../middleware/auth');
const { ADMIN_ROLES } = require('../utils/roles');

// The live organisation dashboard. Admin + CEO only — it exposes every staff
// member's whereabouts and every open approval, which is precisely the data the
// rest of the app is careful to scope per-hierarchy.
router.get('/live', protect, authorize(...ADMIN_ROLES), getLive);

module.exports = router;
