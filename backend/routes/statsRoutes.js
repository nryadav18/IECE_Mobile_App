const express = require('express');
const { getOverview } = require('../controllers/statsController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Every authenticated role sees the home dashboard, so no role gate here.
router.get('/overview', protect, getOverview);

module.exports = router;
