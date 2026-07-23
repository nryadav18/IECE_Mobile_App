const Notification = require('../models/Notification');

// @desc    List the caller's notifications (newest first, paginated)
// @route   GET /api/notifications?page=&limit=&unread=true
// @access  Private
exports.getNotifications = async (req, res) => {
  try {
    const filter = { recipient: req.user._id };
    if (String(req.query.unread) === 'true') filter.read = false;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

    const [total, unreadCount, notifications] = await Promise.all([
      Notification.countDocuments({ recipient: req.user._id }),
      Notification.countDocuments({ recipient: req.user._id, read: false }),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.status(200).json({ success: true, total, unreadCount, page, data: notifications });
  } catch (error) {
    console.error('getNotifications error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Unread count only (cheap — for the bell badge)
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ recipient: req.user._id, read: false });
    res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error('getUnreadCount error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Mark a single notification as read
// @route   POST /api/notifications/:id/read
// @access  Private
exports.markRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    console.error('markRead error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Mark all of the caller's notifications as read
// @route   POST /api/notifications/read-all
// @access  Private
exports.markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.status(200).json({ success: true, modified: result.modifiedCount });
  } catch (error) {
    console.error('markAllRead error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
