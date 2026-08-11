const Notification = require('../models/Notification');
const LeaveRequest = require('../models/LeaveRequest');
const SubstitutionRequest = require('../models/SubstitutionRequest');
const SchoolVisitRequest = require('../models/SchoolVisitRequest');
const SchoolHoliday = require('../models/SchoolHoliday');
const User = require('../models/User');

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

// @desc    Consolidated badge counts for the whole app: unread inbox + the
//          role-scoped "pending / needs-action" counts per section, plus a grand
//          total used for the app-icon badge (like WhatsApp's count).
// @route   GET /api/notifications/badges
// @access  Private
exports.getBadges = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    // Every user has an unread inbox count.
    const jobs = { unread: Notification.countDocuments({ recipient: userId, read: false }) };

    // Actionable "pending" sections depend on who can approve what.
    if (role === 'creator_admin') {
      jobs.leave = LeaveRequest.countDocuments({ status: 'pending' });
      jobs.schoolVisit = SchoolVisitRequest.countDocuments({ status: 'pending' });
      jobs.substitution = SubstitutionRequest.countDocuments({ status: 'pending' });
      jobs.faces = User.countDocuments({ 'faceRegistrations.status': 'pending' });
      jobs.holidays = SchoolHoliday.countDocuments({ status: 'pending' });
    } else if (role === 'ceo') {
      // A CEO reviews substitutions they didn't raise themselves.
      jobs.substitution = SubstitutionRequest.countDocuments({ status: 'pending', raisedBy: { $ne: userId } });
    }

    const keys = Object.keys(jobs);
    const values = await Promise.all(keys.map((k) => jobs[k]));
    const counts = {};
    keys.forEach((k, i) => { counts[k] = values[i]; });

    const { unread, ...sections } = counts;
    const sectionsTotal = Object.values(sections).reduce((a, b) => a + b, 0);

    // Grand total powering the app-icon badge: unread + everything pending.
    const total = unread + sectionsTotal;

    res.status(200).json({ success: true, unread, sections, total });
  } catch (error) {
    console.error('getBadges error:', error);
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
