const Activity = require('../models/Activity');

// @desc    Get all activities (with optional filtering)
// @route   GET /api/activities
// @access  Private
exports.getActivities = async (req, res) => {
  try {
    const { schoolId, trainerId, status } = req.query;
    let query = {};
    if (schoolId) query.schoolId = schoolId;
    if (trainerId) query.trainerId = trainerId;
    if (status) query.status = status;

    const activities = await Activity.find(query)
      .populate('schoolId', 'name state')
      .populate('trainerId', 'name email');
      
    res.status(200).json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Assign an activity to a trainer
// @route   POST /api/activities
// @access  Private/CreatorAdmin/TeamLeader
exports.createActivity = async (req, res) => {
  try {
    const { name, schoolId, trainerId } = req.body;
    const activity = await Activity.create({ name, schoolId, trainerId });
    res.status(201).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Trainer submits an activity
// @route   PUT /api/activities/:id/submit
// @access  Private/Trainer
exports.submitActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
    
    // In a real app we check req.user._id === activity.trainerId.toString()
    activity.proofPhotoUrl = req.body.proofPhotoUrl || activity.proofPhotoUrl;
    activity.status = 'Submitted';
    activity.approvalHistory.push({ action: 'Submitted', userId: req.user ? req.user._id : null });
    
    await activity.save();
    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    School approves an activity
// @route   PUT /api/activities/:id/approve-school
// @access  Private/Chairman
exports.approveSchoolActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
    
    activity.status = 'Approved by School';
    activity.approvalHistory.push({ action: 'Approved by School', userId: req.user ? req.user._id : null });
    
    await activity.save();
    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Admin confirms an activity
// @route   PUT /api/activities/:id/confirm-admin
// @access  Private/CreatorAdmin/TeamLeader
exports.confirmAdminActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
    
    activity.status = 'Completed Successfully';
    activity.approvalHistory.push({ action: 'Confirmed by Admin', userId: req.user ? req.user._id : null });
    
    await activity.save();
    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Send back an activity
// @route   PUT /api/activities/:id/send-back
// @access  Private/Chairman/CreatorAdmin/TeamLeader
exports.sendBackActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
    
    activity.status = 'Sent Back';
    activity.approvalHistory.push({ action: 'Sent Back', userId: req.user ? req.user._id : null });
    
    await activity.save();
    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
