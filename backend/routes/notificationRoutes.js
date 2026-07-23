const express = require('express');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Every authenticated user has an inbox.
router.get('/', protect, getNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.post('/read-all', protect, markAllRead);
router.post('/:id/read', protect, markRead);

module.exports = router;
