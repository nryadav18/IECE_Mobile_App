const SchoolHoliday = require('../models/SchoolHoliday');
const School = require('../models/School');
const { notifyUserById, notifyRole } = require('../utils/pushNotification');

// @desc    Apply for a school holiday (goes to admin for approval)
// @route   POST /api/holidays
// @access  Private/Trainer,TeamLeader
exports.applyHoliday = async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'A valid date (YYYY-MM-DD) is required' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required for the holiday request' });
    }

    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'You are not associated with a school' });
    }

    // One request per school per day.
    const existing = await SchoolHoliday.findOne({ schoolId, date });
    if (existing) {
      const label = existing.status === 'approved' ? 'already marked as a holiday' : `already ${existing.status}`;
      return res.status(400).json({ success: false, message: `${date} is ${label} for your school.` });
    }

    const holiday = await SchoolHoliday.create({
      schoolId,
      date,
      reason: reason.trim(),
      appliedBy: req.user._id,
      status: 'pending',
    });

    res.status(201).json({ success: true, data: holiday });

    // Holiday requests are reviewed by the admin only — notify all admins.
    const school = await School.findById(schoolId);
    notifyRole(
      'creator_admin',
      '🏫 School Holiday Request',
      `${req.user.name} requested ${date} as a holiday for ${school ? school.name : 'a school'}.`,
      { type: 'holiday_approval', role: 'creator_admin' }
    ).catch((e) => console.error('Holiday admin notify error:', e.message));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'This date is already requested for your school.' });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List holidays relevant to the caller
// @route   GET /api/holidays?schoolId=&status=
// @access  Private
exports.getHolidays = async (req, res) => {
  try {
    const query = {};
    const { role } = req.user;

    if (role === 'creator_admin') {
      if (req.query.schoolId) query.schoolId = req.query.schoolId;
    } else {
      // Field staff → only their own school's holidays.
      if (!req.user.schoolId) return res.status(200).json({ success: true, data: [] });
      query.schoolId = req.user.schoolId;
    }

    if (req.query.status) query.status = req.query.status;

    const holidays = await SchoolHoliday.find(query)
      .populate('schoolId', 'name')
      .populate('appliedBy', 'name role')
      .sort({ date: -1 });

    res.status(200).json({ success: true, data: holidays });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Approve / reject a holiday request
// @route   PUT /api/holidays/:id/status
// @access  Private/CreatorAdmin
exports.reviewHoliday = async (req, res) => {
  try {
    const { status, rejectionRemark } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const holiday = await SchoolHoliday.findById(req.params.id).populate('appliedBy', 'role');
    if (!holiday) return res.status(404).json({ success: false, message: 'Holiday request not found' });

    // Authorization: admin only.
    if (req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can review holiday requests' });
    }

    holiday.status = status;
    holiday.reviewedBy = req.user._id;
    holiday.rejectionRemark = status === 'rejected' ? (rejectionRemark || '') : '';
    await holiday.save();

    res.status(200).json({ success: true, data: holiday });

    // Notify the applicant of the decision. `role` (trainer / team_leader) lets
    // the app open the right portal when the notification is tapped.
    const applicant = holiday.appliedBy;
    notifyUserById(
      applicant?._id || applicant,
      status === 'approved' ? '✅ School Holiday Approved' : '❌ School Holiday Rejected',
      status === 'approved'
        ? `Your school holiday on ${holiday.date} was approved. Check-in/out is disabled that day.`
        : `Your school holiday request for ${holiday.date} was rejected.${rejectionRemark ? ` Remark: "${rejectionRemark}"` : ''}`,
      { type: 'holiday_status_update', role: applicant?.role }
    ).catch((e) => console.error('Holiday status notify error:', e.message));
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a holiday (applicant while pending, or chairman/admin)
// @route   DELETE /api/holidays/:id
// @access  Private
exports.deleteHoliday = async (req, res) => {
  try {
    const holiday = await SchoolHoliday.findById(req.params.id);
    if (!holiday) return res.status(404).json({ success: false, message: 'Holiday request not found' });

    const isAdmin = req.user.role === 'creator_admin';
    const isApplicant = holiday.appliedBy.toString() === req.user.id;

    if (!isAdmin && !(isApplicant && holiday.status === 'pending')) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this holiday' });
    }

    await holiday.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
