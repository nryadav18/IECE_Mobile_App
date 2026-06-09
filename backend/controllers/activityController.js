const Activity = require('../models/Activity');
const User = require('../models/User');
const { sendPushNotification } = require('../utils/pushNotification');

const notifyAdminForActivityApproval = async (activity, senderId) => {
  const admins = await User.find({ role: 'creator_admin' });
  const title = 'New Activity Pending Approval';
  const message = `A new activity (${activity.name}) requires your approval.`;

  for (const admin of admins) {
    if (admin.expoPushToken) {
      await sendPushNotification(admin.expoPushToken, title, message, { type: 'activity_approval', relatedId: activity._id.toString() });
    }
  }
};

exports.getActivities = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'chairman') {
      const School = require('../models/School');
      const schools = await School.find({ chairmanId: req.user.id });
      const schoolIds = schools.map(s => s._id);
      query.schoolId = { $in: schoolIds };
    } else {
      if (req.query.schoolId) query.schoolId = req.query.schoolId;
      if (req.query.uploaderId) query.uploaderId = req.query.uploaderId;
    }
    
    // Support filtering by status
    if (req.query.status) {
      query.status = req.query.status;
    }

    const activities = await Activity.find(query)
      .populate('schoolId', 'name chairmanId')
      .populate('uploaderId', 'name email role')
      .populate('organizers', 'name email role')
      .sort('-activityDate -createdAt');
      
    res.status(200).json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getActivityById = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id)
      .populate('schoolId', 'name chairmanId')
      .populate('uploaderId', 'name email role')
      .populate('organizers', 'name email role');
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }
    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createActivity = async (req, res) => {
  try {
    req.body.uploaderId = req.user.id;
    req.body.status = 'pending';
    
    const activity = await Activity.create(req.body);

    // Send notification to the IECE admins
    await notifyAdminForActivityApproval(activity, req.user.id);

    res.status(201).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateActivity = async (req, res) => {
  try {
    let activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Check permission: owner or creator_admin
    if (activity.uploaderId.toString() !== req.user.id && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to update this activity' });
    }

    const previousStatus = activity.status;

    // Update fields
    const allowedFields = ['name', 'description', 'schoolId', 'organizers', 'mediaUrls', 'activityDate'];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        activity[field] = req.body[field];
      }
    });

    if (previousStatus === 'approved' || previousStatus === 'rejected') {
      activity.status = 'pending';
      await activity.save();
      await notifyAdminForActivityApproval(activity, req.user.id);
    } else {
      await activity.save();
    }

    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateActivityStatus = async (req, res) => {
  try {
    const { status, rejectionRemark } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const activity = await Activity.findByIdAndUpdate(
      req.params.id,
      { status, rejectionRemark },
      { new: true, runValidators: true }
    );

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Send notification back to uploader
    let msg = `Your activity (${activity.name}) has been ${status} by IECE Admin.`;
    if (status === 'rejected' && rejectionRemark) {
      msg += ` Remark: "${rejectionRemark}"`;
    }
    const uploaderTitle = `Activity ${status.charAt(0).toUpperCase() + status.slice(1)}`;

    const uploader = await User.findById(activity.uploaderId);
    if (uploader && uploader.expoPushToken) {
      await sendPushNotification(uploader.expoPushToken, uploaderTitle, msg, { type: 'activity_status_update', relatedId: activity._id.toString() });
    }

    // If approved, notify the school's chairman so they are aware
    if (status === 'approved') {
      const School = require('../models/School');
      const school = await School.findById(activity.schoolId);
      if (school && school.chairmanId) {
        const chairman = await User.findById(school.chairmanId);
        if (chairman && chairman.expoPushToken) {
           await sendPushNotification(chairman.expoPushToken, 'New Activity Approved', `An activity (${activity.name}) at your school was approved by IECE Admin.`, { type: 'general', relatedId: activity._id.toString() });
        }
      }
    }

    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Check permission: owner or creator_admin
    if (activity.uploaderId.toString() !== req.user.id && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this activity' });
    }

    await activity.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
