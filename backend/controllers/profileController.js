const User = require('../models/User');
const Attendance = require('../models/Attendance');
const VisitReport = require('../models/VisitReport');
const Activity = require('../models/Activity');

// @desc    Get detailed user profile (Admin/TL/Self)
// @route   GET /api/profile/:id
// @access  Private
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id === 'me' ? req.user.id : req.params.id;
    
    const user = await User.findById(userId)
        .select('-password -faceEmbedding -faceEmbeddingV2')
        .populate('schoolId')
        .populate('teamLeaderId', 'name email');
    
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    
    // Auth Check: 
    // - creator_admin can view anyone.
    // - chairman can view anyone in their school (skipped strict check for simplicity, can add later)
    // - team_leader can view their assigned trainers or themselves.
    // - trainer can view themselves.
    if (req.user.role !== 'creator_admin' && req.user.id !== userId) {
        if (req.user.role === 'team_leader' && user.teamLeaderId?.toString() !== req.user.id) {
            return res.status(403).json({ success: false, error: 'Not authorized to view this profile' });
        }
        if (req.user.role === 'trainer') {
            return res.status(403).json({ success: false, error: 'Not authorized to view this profile' });
        }
    }

    const attendance = await Attendance.find({ trainerId: userId }).sort('-date');
    const visitReports = await VisitReport.find({ trainerId: userId }).sort('-dateOfInspection');
    
    // Activities where user is uploader or an organizer
    const activities = await Activity.find({
        $or: [
            { uploaderId: userId },
            { organizers: userId }
        ]
    }).sort('-createdAt');
    
    res.status(200).json({
      success: true,
      data: {
         profile: user,
         attendance,
         visitReports,
         activities
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
