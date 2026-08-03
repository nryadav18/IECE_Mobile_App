const User = require('../models/User');
const Attendance = require('../models/Attendance');
const VisitReport = require('../models/VisitReport');
const Activity = require('../models/Activity');
const { HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES } = require('../utils/roles');
const { getApprovedLeaveWindows } = require('../utils/leaveStatus');
const { getSubjectLeaveWindows, getSubstituteDutyWindows } = require('../utils/substitutionStatus');

// @desc    Get detailed user profile (Admin/TL/Self)
// @route   GET /api/profile/:id
// @access  Private
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id === 'me' ? req.user.id : req.params.id;
    
    const user = await User.findById(userId)
        .select('-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
        .populate('schoolId')
        .populate('schoolIds')
        .populate('faceRegistrations.schoolId', 'name state')
        .populate('teamLeaderId', 'name email')
        .populate('teamId', 'name');

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Auth Check:
    // - creator_admin / ceo can view anyone.
    // - (trainee) team_leader can view their assigned trainers or themselves.
    // - a head can view anyone belonging to one of their teams.
    // - everyone else can view only themselves.
    if (!ADMIN_ROLES.includes(req.user.role) && req.user.id !== String(userId)) {
        if (LEADER_ROLES.includes(req.user.role)) {
            // teamLeaderId is populated above, so it's a subdocument — read its _id
            // (falling back to the raw value if it wasn't populated) before comparing.
            const trainerTeamLeaderId = (user.teamLeaderId?._id || user.teamLeaderId)?.toString();
            if (trainerTeamLeaderId !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Not authorized to view this profile' });
            }
        } else if (HEAD_ROLES.includes(req.user.role)) {
            const targetTeamId = (user.teamId?._id || user.teamId)?.toString();
            const headTeamIds = (req.user.teamIds || []).map(id => id.toString());
            if (!targetTeamId || !headTeamIds.includes(targetTeamId)) {
                return res.status(403).json({ success: false, error: 'Not authorized to view this profile' });
            }
        } else {
            return res.status(403).json({ success: false, error: 'Not authorized to view this profile' });
        }
    }

    // Both schools populated, so a day split across two shows as
    // "checked in at A, checked out at B" to whoever is viewing this profile.
    const attendance = await Attendance.find({ trainerId: userId })
      .populate('schoolId', 'name state')
      .populate('checkOutSchoolId', 'name state')
      .sort('-date');
    const visitReports = await VisitReport.find({ trainerId: userId }).sort('-dateOfInspection');

    // Activities where user is uploader or an organizer
    const activities = await Activity.find({
        $or: [
            { uploaderId: userId },
            { organizers: userId }
        ]
    }).sort('-createdAt');

    // Approved leave + substitution windows — so anyone authorized to view this
    // profile sees the SAME "On Leave" / "On Substitution" days on the calendar as
    // the person does in their own portal.
    const [leaveDays, substitutionLeaves, substitutionDuties] = await Promise.all([
      getApprovedLeaveWindows(userId),
      getSubjectLeaveWindows(userId),
      getSubstituteDutyWindows(userId),
    ]);

    res.status(200).json({
      success: true,
      data: {
         profile: user,
         attendance,
         visitReports,
         activities,
         leaveDays,
         substitutionLeaves,
         substitutionDuties
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get Team Leader's Trainers Performance
// @route   GET /api/profile/team-leader/trainers
// @access  Private/TeamLeader
exports.getAssignedTrainersProfiles = async (req, res) => {
  try {
    if (req.user.role !== 'team_leader' && req.user.role !== 'creator_admin') {
         return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    // if admin wants to see a TL's trainers, they can pass tlId in query
    const tlId = req.user.role === 'creator_admin' && req.query.tlId ? req.query.tlId : req.user.id;

    const trainers = await User.find({ teamLeaderId: tlId }).select('-password -faceEmbedding -faceEmbeddingV2');
    
    const trainerIds = trainers.map(t => t._id);

    const allAttendance = await Attendance.find({ trainerId: { $in: trainerIds } });
    const allVisitReports = await VisitReport.find({ trainerId: { $in: trainerIds } });
    const allActivities = await Activity.find({ uploaderId: { $in: trainerIds } });

    // Aggregate data per trainer
    const aggregatedData = trainers.map(trainer => {
        return {
            trainer,
            attendance: allAttendance.filter(a => a.trainerId.toString() === trainer._id.toString()),
            visitReports: allVisitReports.filter(v => v.trainerId.toString() === trainer._id.toString()),
            activities: allActivities.filter(a => a.uploaderId.toString() === trainer._id.toString())
        };
    });

    res.status(200).json({
      success: true,
      data: aggregatedData
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
