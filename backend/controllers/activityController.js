const Activity = require('../models/Activity');
const User = require('../models/User');
const { HEAD_ROLES, LEADER_ROLES } = require('../utils/roles');
const { sendPushNotification } = require('../utils/pushNotification');
const { notify } = require('../utils/notify');
const { getApproverIdsFor, canApproveFor } = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { decisionOf, trail } = require('../utils/approvalTrail');
const { purgeAssets, purgeSummary, purgeProblem } = require('../utils/cloudinary');

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
      // Trainer: their own activities, plus any they were TAGGED in as an
      // organiser. Being named on an activity is the same claim to it as having
      // uploaded it — they were there and they ran it — so it belongs in their
      // feed rather than only in the uploader's.
      query.$or = [{ uploaderId: req.user._id }, { organizers: req.user._id }];
    } else if (LEADER_ROLES.includes(role)) {
      // (Trainee) Team Leader: their school's activities + their team members' (and own) activities.
      const teamMemberIds = await User.find({ teamLeaderId: req.user._id }).distinct('_id');
      const orClauses = [
        { uploaderId: { $in: [...teamMemberIds, req.user._id] } },
        { organizers: req.user._id },
      ];
      if (req.user.schoolId) orClauses.push({ schoolId: req.user.schoolId });
      query.$or = orClauses;
    } else if (HEAD_ROLES.includes(role)) {
      // Head: activities of everyone in the teams they oversee + their own school + self.
      const memberIds = await User.find({ teamId: { $in: req.user.teamIds || [] } }).distinct('_id');
      const orClauses = [
        { uploaderId: { $in: [...memberIds, req.user._id] } },
        { organizers: req.user._id },
      ];
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
    const previousMedia = [...(activity.mediaUrls || [])];

    // Update fields
    const allowedFields = ['name', 'description', 'schoolId', 'organizers', 'mediaUrls', 'activityDate'];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        activity[field] = req.body[field];
      }
    });

    // Removing a photo in the edit screen has to remove it from the cloud too.
    // Until now the URL was simply dropped from the document and the file stayed
    // in the Cloudinary account forever, unreferenced and unreachable — there was
    // no longer anything anywhere that knew it existed.
    const keptMedia = new Set(activity.mediaUrls || []);
    const droppedMedia = previousMedia.filter((url) => !keptMedia.has(url));
    if (droppedMedia.length) await purgeAssets(droppedMedia);

    if (req.user.role === 'creator_admin') {
      // Admin edits are trusted: auto-approve and don't send it back into the
      // approval queue (no re-approval notification to admins). It is still an
      // approval, and the Admin who made it is still the one accountable for it.
      const decidedAt = new Date();
      activity.status = 'approved';
      activity.decidedBy = decisionOf(req.user, 'auto_approved', decidedAt);
      await activity.save();
      trail({
        entityType: 'activity',
        entityId: activity._id,
        entityLabel: activity.name,
        subject: { _id: activity.uploaderId },
        actor: req.user,
        action: 'auto_approved',
        note: 'Approved automatically as part of an Admin edit.',
        school: activity.schoolId,
        at: decidedAt,
      });
    } else if (previousStatus === 'approved' || previousStatus === 'rejected') {
      // Edited after a decision — it goes back to the uploader's approver as a
      // fresh request, and the old rejection reason no longer applies. The old
      // approver must go with it: they signed off on something that no longer
      // exists, and leaving their name on it would misattribute the new version.
      activity.status = 'pending';
      activity.rejectionRemark = undefined;
      activity.decidedBy = null;
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

    const decidedAt = new Date();
    existing.status = status;
    existing.rejectionRemark = status === 'rejected' ? rejectionRemark.trim() : undefined;
    // Until now the approver's name existed only inside the notification text
    // below and was thrown away with it, which is precisely why an activity
    // approved by one of three leaders could not be traced afterwards.
    existing.decidedBy = decisionOf(req.user, status, decidedAt);
    await existing.save();
    const activity = existing;

    trail({
      entityType: 'activity',
      entityId: activity._id,
      entityLabel: activity.name,
      subject: uploader,
      actor: req.user,
      action: status,
      note: activity.rejectionRemark || '',
      school: activity.schoolId,
      at: decidedAt,
    });

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

    // Everyone tagged as an organiser gets told the moment it is published —
    // the activity now appears on their Home screen, and expecting them to
    // notice that on their own is how a tag goes unseen. The uploader is
    // excluded: they already got the decision notification above.
    if (status === 'approved') {
      try {
        const organizerIds = (activity.organizers || [])
          .map(String)
          .filter((id) => id !== String(activity.uploaderId));

        if (organizerIds.length) {
          await notify(organizerIds, {
            type: 'activity_tagged',
            title: '🏷️ You Were Tagged in an Activity',
            body: `"${activity.name}" — the activity you were tagged in as an organiser — has been approved and now appears on your home screen.`,
            data: { relatedId: String(activity._id), activityId: String(activity._id) },
          });
        }
      } catch (e) {
        console.error('Organizer tag notification error:', e.message);
      }
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
    // Populated for the Approval Log: a log row snapshots the names, and this is
    // the last moment they can be read — a second from now the document is gone.
    const activity = await Activity.findById(req.params.id)
      .populate('uploaderId', 'name role')
      .populate('schoolId', 'name');
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    // Check permission: owner or creator_admin
    const uploaderId = String(activity.uploaderId?._id || activity.uploaderId);
    if (uploaderId !== req.user.id && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this activity' });
    }

    // The photos and videos go FIRST, and the document only goes if they did.
    //
    // Order matters and is not interchangeable: the document is the only record
    // of which files belong to this activity. Delete it first and a Cloudinary
    // failure leaves files nobody can ever name again. This way a failure is
    // recoverable — the activity is still there, and deleting it again retries
    // exactly the files that survived.
    const purge = await purgeAssets(activity.mediaUrls || []);
    if (!purge.ok) {
      // Whatever DID get deleted is dropped from the document, so a retry does
      // not re-attempt files that are already gone.
      activity.mediaUrls = (activity.mediaUrls || []).filter((url) => !purge.gone.includes(url));
      await activity.save();
      return res.status(502).json({
        success: false,
        error: `The activity was NOT deleted. ${purgeProblem(purge)}`,
        cloud: { deleted: purge.deleted, failed: purge.failed },
      });
    }

    const deletedAt = new Date();
    await activity.deleteOne();
    res.status(200).json({
      success: true,
      data: {},
      message: `Activity deleted. ${purgeSummary(purge)}`,
      cloud: { deleted: purge.deleted, missing: purge.missing, failed: 0 },
    });

    // A deletion is a decision like any other, and it is the ONE decision whose
    // subject cannot be inspected afterwards — the activity no longer exists to
    // be looked at. If it is not written here it is unanswerable forever.
    trail({
      entityType: 'activity',
      entityId: activity._id,
      entityLabel: activity.name,
      subject: activity.uploaderId,
      actor: req.user,
      action: 'deleted',
      note: purge.requested
        ? `Activity deleted with its ${purge.requested} photo/video file(s). ${purgeSummary(purge)}`
        : 'Activity deleted. It had no photos or videos.',
      school: activity.schoolId,
      at: deletedAt,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Delete ONLY an activity's photos and videos, keeping the activity
// @route   DELETE /api/activities/:id/media
// @access  Private/Admin
//
// The Admin's housekeeping tool for the Cloudinary free tier: it empties an
// activity of its media — in the cloud, not just in the database — while the
// activity itself (name, description, date, school, organisers, approval and
// who approved it) is left exactly as it was. The record of what happened
// survives; only the storage cost goes.
//
// Admin-only on purpose. An uploader who wants their photos gone can delete
// their whole activity; stripping the media out from under an APPROVED activity
// while leaving the approval standing is an archival decision, not an
// authoring one.
exports.deleteActivityMedia = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id)
      .populate('uploaderId', 'name role')
      .populate('schoolId', 'name');
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    const urls = [...(activity.mediaUrls || [])];
    if (urls.length === 0) {
      return res.status(200).json({
        success: true,
        data: activity,
        message: 'This activity has no photos or videos.',
        cloud: { requested: 0, deleted: 0, missing: 0, failed: 0 },
      });
    }

    const purge = await purgeAssets(urls);

    // Only URLs the cloud has confirmed gone are dropped. A file that could not
    // be destroyed keeps its URL, because that URL is the one handle left on it
    // — forget it and the file is unreachable for good.
    activity.mediaUrls = urls.filter((url) => !purge.gone.includes(url));
    await activity.save();

    const removed = purge.deleted + purge.missing;

    // Logged on BOTH paths, including the partial failure: files really were
    // destroyed, and an audit trail that only records clean runs is not one.
    trail({
      entityType: 'activity',
      entityId: activity._id,
      entityLabel: activity.name,
      subject: activity.uploaderId,
      actor: req.user,
      action: 'media_deleted',
      note: purge.ok
        ? `${removed} photo/video file(s) permanently deleted from cloud storage. The activity itself was kept.`
        : `${removed} of ${purge.requested} photo/video file(s) deleted from cloud storage; ${purge.failed} could not be removed. The activity itself was kept.`,
      school: activity.schoolId,
    });

    if (!purge.ok) {
      return res.status(502).json({
        success: false,
        error: `${removed} of ${purge.requested} file(s) were removed. ${purgeProblem(purge)}`,
        data: activity,
        cloud: { requested: purge.requested, deleted: purge.deleted, missing: purge.missing, failed: purge.failed },
      });
    }

    res.status(200).json({
      success: true,
      data: activity,
      message: `Removed ${removed} file(s). ${purgeSummary(purge)} The activity itself is unchanged.`,
      cloud: { requested: purge.requested, deleted: purge.deleted, missing: purge.missing, failed: 0 },
    });
  } catch (error) {
    console.error('deleteActivityMedia error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};
