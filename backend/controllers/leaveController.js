const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { sendLeaveEmail } = require('../utils/email');
const {
  getAdminOnlyRecipientIds,
  getLeaveApprovalRecipientIds,
} = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const formatDate = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const roleLabel = (role) => ROLE_LABELS[role] || role;

// Start-of-day for a given date (defaults to now).
const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// The earliest date a leave may START: the day after tomorrow (today + 2 days).
// A person cannot apply for today or tomorrow.
const earliestLeaveStart = () => {
  const d = startOfDay();
  d.setDate(d.getDate() + 2);
  return d;
};

const dayCount = (from, to) => {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

/**
 * Fan a leave event out to a set of recipients: one persisted inbox
 * notification + live push (via notify()), and a branded email to everyone who
 * has an email on file. Never throws — delivery is best-effort and must not
 * fail the HTTP response that already went out.
 */
const dispatch = async (recipientIds, inbox, email) => {
  const ids = [...new Set((recipientIds || []).map(String))];
  if (ids.length === 0) return;

  notify(ids, inbox).catch((e) => console.error('Leave notify error:', e.message));

  try {
    const users = await User.find({ _id: { $in: ids } }).select('email name');
    await Promise.all(
      users
        .filter((u) => u.email)
        .map((u) =>
          sendLeaveEmail(u.email, email).catch((e) =>
            console.error(`Leave email error (${u.email}):`, e.message)
          )
        )
    );
  } catch (e) {
    console.error('Leave email fan-out error:', e.message);
  }
};

// Shape a request for API responses (populated).
const populateRequest = (query) =>
  query
    .populate('applicant', 'name role email schoolIds')
    .populate({ path: 'applicant', populate: { path: 'schoolIds', select: 'name' } })
    .populate('reviewedBy', 'name role');

const isAdmin = (role) => role === 'creator_admin';

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

// @desc    Apply for leave (self-service). Raised to the Admin only.
// @route   POST /api/leaves
// @access  Private/Field staff (all roles except Admin + CEO)
exports.applyLeave = async (req, res) => {
  try {
    const { reason, fromDate, toDate, proofs } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason for the leave is required' });
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'Both a from-date and a to-date are required' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid dates provided' });
    }
    if (startOfDay(from) > startOfDay(to)) {
      return res.status(400).json({ success: false, message: 'The from-date cannot be after the to-date' });
    }

    // Core rule: leave cannot start today or tomorrow — earliest is the day
    // after tomorrow. Enforced server-side (authoritative).
    const earliest = earliestLeaveStart();
    if (startOfDay(from) < earliest) {
      return res.status(400).json({
        success: false,
        message: `Leave can only be applied from the day after tomorrow (${formatDate(earliest)}) onwards. You cannot apply for today or tomorrow.`,
      });
    }

    // Block an overlapping open/approved leave for the same person.
    const overlap = await LeaveRequest.findOne({
      applicant: req.user._id,
      status: { $in: ['pending', 'approved'] },
      fromDate: { $lte: to },
      toDate: { $gte: from },
    });
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: 'You already have a leave request that overlaps these dates.',
      });
    }

    const cleanProofs = Array.isArray(proofs)
      ? proofs.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
      : [];

    const request = await LeaveRequest.create({
      applicant: req.user._id,
      reason: reason.trim(),
      fromDate: from,
      toDate: to,
      proofs: cleanProofs,
      status: 'pending',
    });

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(201).json({ success: true, data: populated });

    // ---- Notify the Admin ONLY (in-app + push + email) ----
    const recipientIds = await getAdminOnlyRecipientIds();
    const rows = [
      { label: 'Applicant', value: `${req.user.name} (${roleLabel(req.user.role)})` },
      { label: 'Reason', value: reason.trim() },
      { label: 'From', value: formatDate(from) },
      { label: 'To', value: formatDate(to) },
      { label: 'Duration', value: `${dayCount(from, to)} day(s)` },
      { label: 'Proof(s) attached', value: cleanProofs.length ? `${cleanProofs.length} file(s)` : 'None' },
    ];

    dispatch(
      recipientIds,
      {
        type: 'leave_request',
        title: '📝 New Leave Request',
        body: `${req.user.name} applied for leave (${formatDate(from)} – ${formatDate(to)}).`,
        data: { requestId: String(request._id), status: 'pending' },
      },
      {
        subject: 'New Leave Request — Action Required',
        title: 'Leave Request Raised',
        intro: `${req.user.name} has applied for leave and is awaiting your decision. Details are below.`,
        rows,
        badge: 'Pending Approval',
        accent: '#0D9488',
        footerNote: 'Please log in to the IECE app to approve or reject this request.',
      }
    );
  } catch (error) {
    console.error('applyLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

// @desc    List leave requests relevant to the caller
// @route   GET /api/leaves?status=&mine=
// @access  Private/Field staff + Admin
exports.getLeaveRequests = async (req, res) => {
  try {
    const { role } = req.user;
    const query = {};
    const mine = String(req.query.mine) === 'true';

    if (mine || !isAdmin(role)) {
      // Applicants only ever see the requests they raised. "mine" is implicit
      // for non-admins; explicit for an admin tracking someone specific.
      query.applicant = req.user._id;
    }
    // Admin (mine !== true) sees every request — the approval queue + history.

    if (req.query.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    const requests = await populateRequest(LeaveRequest.find(query)).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    console.error('getLeaveRequests error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get a single leave request
// @route   GET /api/leaves/:id
// @access  Private (applicant or Admin)
exports.getLeaveRequest = async (req, res) => {
  try {
    const request = await populateRequest(LeaveRequest.findById(req.params.id));
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const isOwner = String(request.applicant?._id || request.applicant) === String(req.user._id);
    if (!isAdmin(req.user.role) && !isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this request' });
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('getLeaveRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Approve / reject / cancel
// ---------------------------------------------------------------------------

// @desc    Approve a leave request (Admin only)
// @route   POST /api/leaves/:id/approve
// @access  Private/Admin
exports.approveLeave = async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id)
      .populate('applicant', 'name role email teamId teamLeaderId schoolIds');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }

    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.decisionAt = new Date();
    request.decisionNote = '';
    await request.save();

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    // ---- Notify the applicant + their hierarchy (leader/heads) + CEO ----
    const applicant = request.applicant;
    const recipientIds = await getLeaveApprovalRecipientIds(applicant);

    const rows = [
      { label: 'Applicant', value: `${applicant.name} (${roleLabel(applicant.role)})` },
      { label: 'From', value: formatDate(request.fromDate) },
      { label: 'To', value: formatDate(request.toDate) },
      { label: 'Duration', value: `${dayCount(request.fromDate, request.toDate)} day(s)` },
      { label: 'Approved by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'leave_approved',
        title: '✅ Leave Approved',
        body: `${applicant.name}'s leave (${formatDate(request.fromDate)} – ${formatDate(request.toDate)}) has been approved.`,
        data: { requestId: String(request._id), status: 'approved' },
      },
      {
        subject: 'Leave Approved',
        title: 'Leave Approved',
        intro: `${applicant.name}'s leave request has been approved by the Admin. Please plan accordingly for the period below.`,
        rows,
        badge: 'Approved',
        accent: '#0D9488',
        footerNote: 'You are receiving this because you are part of this staff member’s reporting line.',
      }
    );
  } catch (error) {
    console.error('approveLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Reject a leave request with a mandatory reason (Admin only)
// @route   POST /api/leaves/:id/reject
// @access  Private/Admin
exports.rejectLeave = async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, message: 'A reason for rejection is required' });
    }

    const request = await LeaveRequest.findById(req.params.id).populate('applicant', 'name role email');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }

    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    request.decisionAt = new Date();
    request.decisionNote = note.trim();
    await request.save();

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    // Tell the applicant it was declined, with the reason.
    dispatch(
      [String(request.applicant._id || request.applicant)],
      {
        type: 'leave_rejected',
        title: '❌ Leave Request Rejected',
        body: `Your leave request was rejected: "${request.decisionNote}"`,
        data: { requestId: String(request._id), status: 'rejected' },
      },
      {
        subject: 'Leave Request Rejected',
        title: 'Leave Request Rejected',
        intro: 'Your leave request has been reviewed by the Admin and was not approved.',
        rows: [
          { label: 'From', value: formatDate(request.fromDate) },
          { label: 'To', value: formatDate(request.toDate) },
          { label: 'Reviewed by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
          { label: 'Reason for rejection', value: request.decisionNote },
        ],
        badge: 'Rejected',
        accent: '#dc2626',
        footerNote: 'If you have questions, please reach out to the Admin.',
      }
    );
  } catch (error) {
    console.error('rejectLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Cancel a pending leave request (applicant withdraws it)
// @route   POST /api/leaves/:id/cancel
// @access  Private (applicant or Admin)
exports.cancelLeave = async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const isOwner = String(request.applicant) === String(req.user._id);
    if (!isOwner && !isAdmin(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this request' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Only pending requests can be cancelled (this one is ${request.status})` });
    }

    request.status = 'cancelled';
    request.decisionAt = new Date();
    await request.save();

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('cancelLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
