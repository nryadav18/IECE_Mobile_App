const User = require('../models/User');
const Activity = require('../models/Activity');
const { notify } = require('../utils/notify');
const { getApprovalSubjectFilter } = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { FACE_APPROVERS, FIELD_STAFF } = require('../utils/roles');
const { decisionOf, trail } = require('../utils/approvalTrail');
const {
  isAnonymousParam,
  findAnonymousRegistration,
  findSchoolRegistration,
} = require('../utils/anonymousLocation');

const roleLabel = (role) => ROLE_LABELS[role] || role;

/**
 * The approvals hub. Two queues live here, and they no longer share an audience:
 *
 * FACIAL REGISTRATIONS -> the Admin, and only the Admin (FACE_APPROVERS).
 *   Admitting a face into the attendance system is an identity decision, so it
 *   sits with the one person accountable for the staff register rather than
 *   with whoever happens to supervise the requester. The route layer refuses
 *   everyone else; the guard below is the second lock on the same door.
 *
 * ACTIVITIES -> whoever sits above the uploader (see getApproverIdsFor):
 *   trainer                     -> their team leader decides — and so may the
 *                                  head(s) over that trainer's team
 *   team / trainee team leader  -> their head decides
 *   head                        -> Admin / CEO decide
 *   Admin + CEO                 -> may decide anything, at any level
 *
 *   Rights are cumulative: a head owns whole teams, so every member of those
 *   teams shows up in their queue, not just the leaders.
 */

// Belt-and-braces for the face queue: the routes already restrict it, so this
// only ever fires if a future route forgets to.
const isFaceApprover = (user) => FACE_APPROVERS.includes(user?.role);

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
 * The ids of every user whose requests THIS approver may decide — their team,
 * or their whole set of teams if they are a head.
 *
 * getApprovalSubjectFilter is the query-shaped twin of getApproverIdsFor (which
 * the permission check uses), so the queue can never show something the actor
 * cannot actually action, nor hide something they can.
 */
async function subjectIdsFor(actor) {
  const filter = getApprovalSubjectFilter(actor);
  if (!filter) return [];
  return User.find(filter).distinct('_id');
}

// ---------------------------------------------------------------------------
// Facial registrations
// ---------------------------------------------------------------------------

// @desc    Every face registration waiting for the Admin
// @route   GET /api/approvals/face
// @access  Private/Admin
exports.getPendingFaceRegistrations = async (req, res) => {
  try {
    if (!isFaceApprover(req.user)) {
      return res.status(403).json({ success: false, message: 'Only the Admin reviews facial registrations.' });
    }

    // Every field staff member in the organisation, not a hierarchy subtree —
    // the Admin's queue is the whole queue.
    const users = await User.find({
      role: { $in: FIELD_STAFF },
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
// @access  Private/Admin
//
// Body: { status: 'approved' | 'rejected', reason? }
exports.reviewFaceRegistration = async (req, res) => {
  try {
    if (!isFaceApprover(req.user)) {
      return res.status(403).json({ success: false, message: 'Only the Admin reviews facial registrations.' });
    }

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

    // The Admin decides for anyone who does school field work. Nobody else has
    // a face registration in the first place, so this is a sanity check on the
    // id rather than a hierarchy test.
    if (!FIELD_STAFF.includes(subject.role)) {
      return res.status(400).json({ success: false, message: 'This user does not mark attendance.' });
    }

    // An anonymous-location head's registration has no school, so the client
    // addresses it with the literal 'anonymous' in place of an id.
    const anonymous = isAnonymousParam(schoolId);
    const reg = anonymous
      ? findAnonymousRegistration(subject)
      : findSchoolRegistration(subject, schoolId);
    if (!reg) {
      return res.status(404).json({
        success: false,
        message: anonymous
          ? 'No facial registration found for this person'
          : 'No facial registration found for this school',
      });
    }
    if (reg.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This registration has already been ${reg.status}.` });
    }

    const decidedAt = new Date();
    reg.status = status;
    reg.rejectionReason = status === 'rejected' ? reason.trim() : null;
    reg.reviewedBy = req.user._id;
    reg.reviewedAt = decidedAt;
    reg.decidedBy = decisionOf(req.user, status, decidedAt);
    syncLegacyFaceStatus(subject);
    await subject.save();

    let schoolName = 'the school';
    let school = null;
    if (!anonymous) {
      const School = require('../models/School');
      school = await School.findById(schoolId).select('name');
      if (school) schoolName = school.name;
    }

    res.status(200).json({ success: true, data: { userId, schoolId, status } });

    trail({
      entityType: 'face_registration',
      entityId: reg._id,
      entityLabel: anonymous
        ? 'Facial registration · any location'
        : `Facial registration · ${schoolName}`,
      subject,
      actor: req.user,
      action: status,
      note: reg.rejectionReason || '',
      school,
      at: decidedAt,
    });

    // Tell the requester the outcome — and, when rejected, exactly why. An
    // anonymous head has no school to name, so the message says what actually
    // changed for them instead: they can now mark attendance anywhere.
    try {
      const who = `${req.user.name} (${roleLabel(req.user.role)})`;
      if (status === 'approved') {
        await notify([subject._id], {
          type: 'face_approved',
          title: '✅ Facial Registration Approved',
          body: anonymous
            ? `${who} approved your facial registration. You can now check in and out from any location.`
            : `${who} approved your facial registration for ${schoolName}. You can now mark attendance there.`,
          data: { schoolId: String(schoolId) },
        });
      } else {
        await notify([subject._id], {
          type: 'face_rejected',
          title: '❌ Facial Registration Rejected',
          body: anonymous
            ? `${who} rejected your facial registration. Reason: ${reg.rejectionReason} — please register again.`
            : `${who} rejected your facial registration for ${schoolName}. Reason: ${reg.rejectionReason} — please register again.`,
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
    const ids = await subjectIdsFor(req.user);
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

module.exports.subjectIdsFor = subjectIdsFor;
module.exports.syncLegacyFaceStatus = syncLegacyFaceStatus;
