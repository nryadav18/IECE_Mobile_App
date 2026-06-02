const express = require('express');
const { getNotifications, markAsRead, markAsProcessed } = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.put('/:id/process', markAsProcessed);

module.exports = router;
