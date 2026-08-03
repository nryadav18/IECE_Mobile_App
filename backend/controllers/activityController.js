const Activity = require('../models/Activity');
const User = require('../models/User');
const { HEAD_ROLES, LEADER_ROLES } = require('../utils/roles');
const { sendPushNotification } = require('../utils/pushNotification');
const { notify } = require('../utils/notify');
const { getApproverIdsFor, canApproveFor } = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');

const roleLabel = (role) => ROLE_LABELS[role] || role;

/**
 * Ask whoever sits directly above the uploader to review a new activity — a
 * trainer's goes to their team leader, a leader's to their head, a head's to
 * Admin/CEO (who are always included as a fallback). Same chain as facial
 * registrations, so staff only ever answer to one person.
 */
const notifyApproversForActivity = async (activity, uploader) => {
  const approverIds = await getApproverIdsFor(uploader);
  await notify(approverIds, {
    type: 'activity_approval',
    title: 'New Activity Pending Approval',
    body: `${uploader.name} (${roleLabel(uploader.role)}) uploaded "${activity.name}" and needs your approval.`,
    data: { relatedId: String(activity._id), activityId: String(activity._id) },
  });
};

exports.getActivities = async (req, res) => {
  try {
    let query = {};
    const { role } = req.user;

    if (role === 'chairman') {
      // School login: only their own school(s) activities.
      const School = require('../models/School');
      const schools = await School.find({ chairmanId: req.user.id });
      query.schoolId = { $in: schools.map(s => s._id) };
    } else if (req.query.schoolId || req.query.uploaderId) {
      // Explicit scoping (portal screens) — honor whatever filter was requested.
      if (req.query.schoolId) query.schoolId = req.query.schoolId;
      if (req.query.uploaderId) query.uploaderId = req.query.uploaderId;
    } else if (role === 'trainer') {
      // Trainer: only their own activities.
      query.uploaderId = req.user._id;
    } else if (LEADER_ROLES.includes(role)) {
      // (Trainee) Team Leader: their school's activities + their team members' (and own) activities.
      const teamMemberIds = await User.find({ teamLeaderId: req.user._id }).distinct('_id');
      const orClauses = [{ uploaderId: { $in: [...teamMemberIds, req.user._id] } }];
      if (req.user.schoolId) orClauses.push({ schoolId: req.user.schoolId });
      query.$or = orClauses;
    } else if (HEAD_ROLES.includes(role)) {
      // Head: activities of everyone in the teams they oversee + their own school + self.
      const memberIds = await User.find({ teamId: { $in: req.user.teamIds || [] } }).distinct('_id');
      const orClauses = [{ uploaderId: { $in: [...memberIds, req.user._id] } }];
      if (req.user.schoolId) orClauses.push({ schoolId: req.user.schoolId });
      query.$or = orClauses;
    }
    // creator_admin (or any other role) with no explicit filter → all activities.

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

    res.status(201).json({ success: true, data: activity });

    // Ask the uploader's own approver to review it. Runs after the response and
    // must never throw — see the unhandledRejection note in server.js.
    try {
      await notifyApproversForActivity(activity, req.user);
    } catch (e) {
      console.error('Activity approval notification error:', e.message);
    }
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

    if (req.user.role === 'creator_admin') {
      // Admin edits are trusted: auto-approve and don't send it back into the
      // approval queue (no re-approval notification to admins).
      activity.status = 'approved';
      await activity.save();
    } else if (previousStatus === 'approved' || previousStatus === 'rejected') {
      // Edited after a decision — it goes back to the uploader's approver as a
      // fresh request, and the old rejection reason no longer applies.
      activity.status = 'pending';
      activity.rejectionRemark = undefined;
      await activity.save();
      try {
        await notifyApproversForActivity(activity, req.user);
      } catch (e) {
        console.error('Activity re-approval notification error:', e.message);
      }
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
    // A rejection with no remark leaves the uploader guessing what to fix.
    if (status === 'rejected' && (!rejectionRemark || !rejectionRemark.trim())) {
      return res.status(400).json({ success: false, error: 'Please give a reason for the rejection so the uploader knows what to fix.' });
    }

    const existing = await Activity.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Only the uploader's own approver may decide — their team leader, their
    // head, or Admin/CEO (who may act at any level).
    const uploader = await User.findById(existing.uploaderId);
    if (!uploader) {
      return res.status(404).json({ success: false, error: 'Uploader not found' });
    }
    if (!(await canApproveFor(req.user, uploader))) {
      return res.status(403).json({ success: false, error: 'This activity is not yours to decide.' });
    }

    existing.status = status;
    existing.rejectionRemark = status === 'rejected' ? rejectionRemark.trim() : undefined;
    await existing.save();
    const activity = existing;

    // Tell the uploader who decided and, when rejected, exactly why.
    const decidedBy = `${req.user.name} (${roleLabel(req.user.role)})`;
    let msg = `Your activity "${activity.name}" has been ${status} by ${decidedBy}.`;
    if (status === 'rejected') {
      msg += ` Reason: "${activity.rejectionRemark}"`;
    }
    const uploaderTitle = `Activity ${status.charAt(0).toUpperCase() + status.slice(1)}`;

    try {
      await notify([activity.uploaderId], {
        type: 'activity_status_update',
        title: uploaderTitle,
        body: msg,
        data: { relatedId: String(activity._id), activityId: String(activity._id) },
      });
    } catch (e) {
      console.error('Activity status notification error:', e.message);
    }

    // The school no longer approves activities, but it is still their school —
    // once approved, let the chairman know so they see what was published.
    if (status === 'approved') {
      try {
        const School = require('../models/School');
        const school = await School.findById(activity.schoolId);
        if (school && school.chairmanId) {
          await notify([school.chairmanId], {
            type: 'activity_status_update',
            title: 'New Activity Approved',
            body: `An activity ("${activity.name}") at your school was approved by ${decidedBy}.`,
            data: { relatedId: String(activity._id), activityId: String(activity._id) },
          });
        }
      } catch (e) {
        console.error('Chairman activity notification error:', e.message);
      }
    }

    res.status(200).json({ success: true, data: activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Toggle "Star Activity" (heads highlight a standout activity)
// @route   PUT /api/activities/:id/star
// @access  Private/Heads + CreatorAdmin
exports.toggleStarActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Default to starring; allow explicit unstar via { starred: false }.
    const starred = req.body.starred === undefined ? true : !!req.body.starred;

    activity.isStarred = starred;
    activity.starredBy = starred ? req.user._id : null;
    activity.starredAt = starred ? new Date() : null;
    await activity.save();

    res.status(200).json({ success: true, data: activity });

    // Notify the uploader when their activity is starred.
    if (starred) {
      const uploader = await User.findById(activity.uploaderId);
      if (uploader && uploader.expoPushToken) {
        await sendPushNotification(
          uploader.expoPushToken,
          '⭐ Your Activity Was Starred',
          `${req.user.name} marked your activity "${activity.name}" as a Star Activity.`,
          { type: 'activity_starred', relatedId: activity._id.toString() }
        );
      }
    }
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
