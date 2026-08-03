const User = require('../models/User');
const Activity = require('../models/Activity');
const { notify } = require('../utils/notify');
const {
  getApproverIdsFor,
  canApproveFor,
} = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');

const roleLabel = (role) => ROLE_LABELS[role] || role;

/**
 * The approvals hub: facial registrations and uploaded activities both wait for
 * a decision from the SAME person — whoever sits directly above the requester
 * (see getApproverIdsFor). Keeping both queues in one controller means the two
 * flows cannot drift apart in who may act, what a rejection requires, or how
 * the outcome is communicated.
 *
 *   trainer                     -> their team leader decides
 *   team / trainee team leader  -> their head decides
 *   head                        -> Admin / CEO decide
 *   Admin + CEO                 -> may decide anything, at any level
 */

// Recompute the coarse aggregate status from the per-school registrations.
// Mirrors the copies in admin/attendance controllers.
function syncLegacyFaceStatus(user) {
  const regs = user.faceRegistrations || [];
  if (regs.some((r) => r.status === 'approved')) {
    user.facialRegistrationStatus = 'approved';
    user.facialRegistrationStatusV2 = 'approved';
  } else if (regs.some((r) => r.status === 'pending')) {
    user.facialRegistrationStatus = 'pending';
    user.facialRegistrationStatusV2 = 'pending';
  } else {
    user.facialRegistrationStatus = 'none';
    user.facialRegistrationStatusV2 = 'none';
  }
}

/**
 * Every user whose requests THIS approver may decide. Built by asking, for each
 * candidate, whether the actor is among their approvers — the same function the
 * permission check uses, so the queue can never show something the actor cannot
 * actually action.
 */
async function subjectsFor(actor) {
  // Only people who raise these requests are worth testing.
  const candidates = await User.find({
    role: { $in: ['trainer', 'team_leader', 'trainee_team_leader', 'zonal_head', 'cluster_head', 'regional_head'] },
    _id: { $ne: actor._id },
  }).select('name role teamId teamLeaderId');

  const allowed = [];
  for (const c of candidates) {
    if (await canApproveFor(actor, c)) allowed.push(c);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Facial registrations
// ---------------------------------------------------------------------------

// @desc    Face registrations awaiting THIS approver's decision
// @route   GET /api/approvals/face
// @access  Private (leaders, heads, admin, CEO)
exports.getPendingFaceRegistrations = async (req, res) => {
  try {
    const subjects = await subjectsFor(req.user);
    const ids = subjects.map((s) => s._id);
    if (ids.length === 0) return res.status(200).json({ success: true, data: [] });

    const users = await User.find({
      _id: { $in: ids },
      'faceRegistrations.status': 'pending',
    })
      .select('-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
      .populate('schoolIds', 'name state')
      .populate('faceRegistrations.schoolId', 'name state');

    res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error('getPendingFaceRegistrations error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Approve or reject a per-school facial registration
// @route   PUT /api/approvals/face/:userId/:schoolId
// @access  Private — must be an approver for that user
//
// Body: { status: 'approved' | 'rejected', reason? }
exports.reviewFaceRegistration = async (req, res) => {
  try {
    const { userId, schoolId } = req.params;
    const { status, reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected.' });
    }
    // A rejection without a reason is useless to the person receiving it.
    if (status === 'rejected' && (!reason || !reason.trim())) {
      return res.status(400).json({ success: false, message: 'Please give a reason for the rejection so they know what to fix.' });
    }

    const subject = await User.findById(userId);
    if (!subject) return res.status(404).json({ success: false, message: 'User not found' });

    if (!(await canApproveFor(req.user, subject))) {
      return res.status(403).json({ success: false, message: 'This registration is not yours to decide.' });
    }

    const reg = (subject.faceRegistrations || []).find(
      (fr) => String(fr.schoolId) === String(schoolId)
    );
    if (!reg) {
      return res.status(404).json({ success: false, message: 'No facial registration found for this school' });
    }
    if (reg.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This registration has already been ${reg.status}.` });
    }

    reg.status = status;
    reg.rejectionReason = status === 'rejected' ? reason.trim() : null;
    reg.reviewedBy = req.user._id;
    reg.reviewedAt = new Date();
    syncLegacyFaceStatus(subject);
    await subject.save();

    const School = require('../models/School');
    const school = await School.findById(schoolId).select('name');
    const schoolName = school ? school.name : 'the school';

    res.status(200).json({ success: true, data: { userId, schoolId, status } });

    // Tell the requester the outcome — and, when rejected, exactly why.
    try {
      const who = `${req.user.name} (${roleLabel(req.user.role)})`;
      if (status === 'approved') {
        await notify([subject._id], {
          type: 'face_approved',
          title: '✅ Facial Registration Approved',
          body: `${who} approved your facial registration for ${schoolName}. You can now mark attendance there.`,
          data: { schoolId: String(schoolId) },
        });
      } else {
        await notify([subject._id], {
          type: 'face_rejected',
          title: '❌ Facial Registration Rejected',
          body: `${who} rejected your facial registration for ${schoolName}. Reason: ${reg.rejectionReason} — please register again.`,
          data: { schoolId: String(schoolId), reason: reg.rejectionReason },
        });
      }
    } catch (e) {
      console.error('Face review notification error:', e.message);
    }
  } catch (error) {
    console.error('reviewFaceRegistration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

// @desc    Activities awaiting THIS approver's decision
// @route   GET /api/approvals/activities
// @access  Private (leaders, heads, admin, CEO)
exports.getPendingActivities = async (req, res) => {
  try {
    const subjects = await subjectsFor(req.user);
    const ids = subjects.map((s) => s._id);
    if (ids.length === 0) return res.status(200).json({ success: true, data: [] });

    const activities = await Activity.find({ uploaderId: { $in: ids }, status: 'pending' })
      .populate('uploaderId', 'name role')
      .populate('schoolId', 'name state')
      .populate('organizers', 'name role')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: activities });
  } catch (error) {
    console.error('getPendingActivities error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.subjectsFor = subjectsFor;
module.exports.syncLegacyFaceStatus = syncLegacyFaceStatus;
