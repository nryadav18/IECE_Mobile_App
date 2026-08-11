const SubstitutionRequest = require('../models/SubstitutionRequest');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { sendSubstitutionEmail } = require('../utils/email');
const {
  getUpwardRecipientIds,
  getSubstitutionApprovalRecipientIds,
  getSubjectScopeFilter,
} = require('../utils/hierarchy');
const { ADMIN_ROLES, FIELD_STAFF } = require('../utils/roles');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { decisionOf, trail } = require('../utils/approvalTrail');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isAdminRole = (role) => ADMIN_ROLES.includes(role);

const formatDate = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const roleLabel = (role) => ROLE_LABELS[role] || role;

const schoolNames = (subject) =>
  (subject && Array.isArray(subject.schoolIds) ? subject.schoolIds : [])
    .map((s) => (s && s.name ? s.name : null))
    .filter(Boolean)
    .join(', ') || '—';

/**
 * Fan a substitution event out to a set of recipients: one persisted inbox
 * notification + live push (via notify()), and a branded email to everyone who
 * has an email on file. Never throws — delivery is best-effort and must not
 * fail the HTTP response that already went out.
 *
 * @param {string[]} recipientIds
 * @param {object} inbox - { type, title, body, data }
 * @param {object} email - { subject, title, intro, rows, accent, badge }
 */
const dispatch = async (recipientIds, inbox, email) => {
  const ids = [...new Set((recipientIds || []).map(String))];
  if (ids.length === 0) return;

  // 1. In-app inbox + push.
  notify(ids, inbox).catch((e) => console.error('Substitution notify error:', e.message));

  // 2. Email everyone who has an address.
  try {
    const users = await User.find({ _id: { $in: ids } }).select('email name');
    await Promise.all(
      users
        .filter((u) => u.email)
        .map((u) =>
          sendSubstitutionEmail(u.email, email).catch((e) =>
            console.error(`Substitution email error (${u.email}):`, e.message)
          )
        )
    );
  } catch (e) {
    console.error('Substitution email fan-out error:', e.message);
  }
};

// Shape a request for API responses (populated).
const populateRequest = (query) =>
  query
    .populate('subject', 'name role email schoolIds')
    .populate({ path: 'subject', populate: { path: 'schoolIds', select: 'name' } })
    .populate('substitute', 'name role email')
    .populate('raisedBy', 'name role')
    .populate('approvedBy', 'name role');

// ---------------------------------------------------------------------------
// Staff pickers
// ---------------------------------------------------------------------------

// @desc    List the staff the caller may raise a request against (role-scoped)
// @route   GET /api/substitutions/staff?search=&page=&limit=
// @access  Private/Leaders,Heads,CEO,Admin
exports.getSubjectStaff = async (req, res) => {
  try {
    const filter = getSubjectScopeFilter(req.user);

    // Never allow raising a request against yourself.
    filter._id = { ...(filter._id || {}), $ne: req.user._id };

    const search = (req.query.search || '').trim();
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [total, staff] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('name role email schoolIds')
        .populate('schoolIds', 'name')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.status(200).json({ success: true, total, page, data: staff });
  } catch (error) {
    console.error('getSubjectStaff error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List candidate substitutes (any staff except CEO/Admin) — CEO/Admin only
// @route   GET /api/substitutions/candidates?search=&page=&limit=
// @access  Private/CEO,Admin
exports.getCandidateSubstitutes = async (req, res) => {
  try {
    const filter = { role: { $in: FIELD_STAFF } };

    const search = (req.query.search || '').trim();
    if (search) filter.name = { $regex: search, $options: 'i' };

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [total, staff] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('name role email schoolIds')
        .populate('schoolIds', 'name')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.status(200).json({ success: true, total, page, data: staff });
  } catch (error) {
    console.error('getCandidateSubstitutes error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

// @desc    Raise a substitution request for a staff member
// @route   POST /api/substitutions
// @access  Private/Leaders,Heads,CEO,Admin
exports.raiseRequest = async (req, res) => {
  try {
    const { subjectId, reason, fromDate, toDate } = req.body;

    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'A subject (staff member) is required' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required' });
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'Both from-date and to-date are required' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid dates provided' });
    }
    if (from > to) {
      return res.status(400).json({ success: false, message: 'From-date cannot be after to-date' });
    }

    const subject = await User.findById(subjectId).populate('schoolIds', 'name');
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Selected staff member not found' });
    }
    if (String(subject._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot raise a request against yourself' });
    }

    // Authorization: the subject must be inside the caller's allowed scope.
    const scope = getSubjectScopeFilter(req.user);
    const inScope = await User.exists({ _id: subject._id, ...scope });
    if (!inScope) {
      return res.status(403).json({ success: false, message: 'You are not authorized to raise a request for this staff member' });
    }

    // Block an overlapping open request for the same subject.
    const overlap = await SubstitutionRequest.findOne({
      subject: subject._id,
      status: { $in: ['pending', 'approved'] },
      fromDate: { $lte: to },
      toDate: { $gte: from },
    });
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: 'There is already an open substitution request for this staff member overlapping these dates.',
      });
    }

    const request = await SubstitutionRequest.create({
      subject: subject._id,
      subjectSchoolsSnapshot: (subject.schoolIds || []).map((s) => s._id || s),
      raisedBy: req.user._id,
      reason: reason.trim(),
      fromDate: from,
      toDate: to,
      status: 'pending',
    });

    const populated = await populateRequest(SubstitutionRequest.findById(request._id));
    res.status(201).json({ success: true, data: populated });

    // ---- Notify upward hierarchy + CEO/Admin (in-app + push + email) ----
    const recipientIds = await getUpwardRecipientIds(req.user);
    const rows = [
      { label: 'Staff to be substituted', value: `${subject.name} (${roleLabel(subject.role)})` },
      { label: 'Current school(s)', value: schoolNames(subject) },
      { label: 'Reason', value: reason.trim() },
      { label: 'From', value: formatDate(from) },
      { label: 'To', value: formatDate(to) },
      { label: 'Raised by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'substitution_request',
        title: '🔁 New Substitution Request',
        body: `${req.user.name} requested a substitution for ${subject.name} (${formatDate(from)} – ${formatDate(to)}).`,
        data: { requestId: String(request._id), status: 'pending' },
      },
      {
        subject: 'New Substitution Request — Action May Be Required',
        title: 'Substitution Request Raised',
        intro: `${req.user.name} has raised a request to temporarily substitute a staff member. Details are below.`,
        rows,
        badge: 'Pending Approval',
        accent: '#0D9488',
      }
    );
  } catch (error) {
    console.error('raiseRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

// @desc    List substitution requests relevant to the caller
// @route   GET /api/substitutions?status=&scope=
// @access  Private/Leaders,Heads,CEO,Admin
exports.getRequests = async (req, res) => {
  try {
    const { role } = req.user;
    const query = {};
    const mine = String(req.query.mine) === 'true';

    if (mine) {
      // "My Requests" — the ones this user personally raised. Works for every
      // role, including a CEO tracking a request that's hidden from their queue.
      query.raisedBy = req.user._id;
    } else if (isAdminRole(role)) {
      // CEO + Admin see the approval queue + full history. A CEO must NOT see
      // requests they raised themselves (those route to Admin only).
      if (role === 'ceo') query.raisedBy = { $ne: req.user._id };
    } else {
      // Leaders/heads see the requests they raised.
      query.raisedBy = req.user._id;
    }

    if (req.query.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    const requests = await populateRequest(SubstitutionRequest.find(query)).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    console.error('getRequests error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get a single substitution request
// @route   GET /api/substitutions/:id
// @access  Private/Leaders,Heads,CEO,Admin
exports.getRequest = async (req, res) => {
  try {
    const request = await populateRequest(SubstitutionRequest.findById(req.params.id));
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const { role, _id } = req.user;
    const isOwner = String(request.raisedBy?._id || request.raisedBy) === String(_id);
    if (!isAdminRole(role) && !isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this request' });
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('getRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Approve / reject / cancel
// ---------------------------------------------------------------------------

// @desc    Approve a request: choose substitute (+ optionally edit dates)
// @route   POST /api/substitutions/:id/approve
// @access  Private/CEO,Admin
exports.approveRequest = async (req, res) => {
  try {
    const { substituteId, fromDate, toDate } = req.body;

    const request = await SubstitutionRequest.findById(req.params.id).populate('subject', 'name role teamId teamIds teamLeaderId schoolIds');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }

    // A CEO cannot approve a request they themselves raised — it routes to Admin.
    if (req.user.role === 'ceo' && String(request.raisedBy) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'A CEO-raised request must be approved by the Admin.' });
    }

    if (!substituteId) {
      return res.status(400).json({ success: false, message: 'Please select a substitute' });
    }

    const substitute = await User.findById(substituteId).populate('schoolIds', 'name');
    if (!substitute) return res.status(404).json({ success: false, message: 'Selected substitute not found' });
    if (isAdminRole(substitute.role)) {
      return res.status(400).json({ success: false, message: 'CEO/Admin cannot be assigned as a substitute' });
    }
    if (String(substitute._id) === String(request.subject._id)) {
      return res.status(400).json({ success: false, message: 'The substitute cannot be the same person being substituted' });
    }

    // Approver may edit the window; fall back to the requested dates.
    let from = request.fromDate;
    let to = request.toDate;
    if (fromDate) {
      from = new Date(fromDate);
      if (isNaN(from.getTime())) return res.status(400).json({ success: false, message: 'Invalid from-date' });
    }
    if (toDate) {
      to = new Date(toDate);
      if (isNaN(to.getTime())) return res.status(400).json({ success: false, message: 'Invalid to-date' });
    }
    if (from > to) {
      return res.status(400).json({ success: false, message: 'From-date cannot be after to-date' });
    }

    // Guard: the chosen substitute must be free of an overlapping approved window.
    const subBusy = await SubstitutionRequest.findOne({
      _id: { $ne: request._id },
      substitute: substitute._id,
      status: 'approved',
      approvedFromDate: { $lte: to },
      approvedToDate: { $gte: from },
    });
    if (subBusy) {
      return res.status(409).json({
        success: false,
        message: `${substitute.name} is already assigned as a substitute during an overlapping period.`,
      });
    }

    const decidedAt = new Date();
    request.substitute = substitute._id;
    request.approvedBy = req.user._id;
    request.approvedFromDate = from;
    request.approvedToDate = to;
    request.status = 'approved';
    request.decisionAt = decidedAt;
    request.decidedBy = decisionOf(req.user, 'approved', decidedAt);
    await request.save();

    const populated = await populateRequest(SubstitutionRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'substitution',
      entityId: request._id,
      entityLabel: `${substitute.name} substituting for ${request.subject.name} · ${formatDate(from)} – ${formatDate(to)}`,
      subject: request.subject,
      actor: req.user,
      action: 'approved',
      at: decidedAt,
    });

    // ---- Notify ONLY the people this substitution concerns ----
    // (subject, substitute, raiser, subject's leader + heads, Admin/CEO) —
    // not every member of both teams, which used to spam the whole org.
    const subject = request.subject;
    const recipientIds = await getSubstitutionApprovalRecipientIds(subject, substitute, request.raisedBy);

    const rows = [
      { label: 'Staff being substituted', value: `${subject.name} (${roleLabel(subject.role)})` },
      { label: 'Substitute', value: `${substitute.name} (${roleLabel(substitute.role)})` },
      { label: 'School(s)', value: schoolNames(subject) },
      { label: 'From', value: formatDate(from) },
      { label: 'To', value: formatDate(to) },
      { label: 'Approved by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'substitution_approved',
        title: '✅ Substitution Approved',
        body: `${substitute.name} will substitute for ${subject.name} (${formatDate(from)} – ${formatDate(to)}).`,
        data: { requestId: String(request._id), status: 'approved' },
      },
      {
        subject: 'Substitution Approved',
        title: 'Substitution Approved',
        intro: `A substitution has been approved. ${substitute.name} will temporarily cover for ${subject.name} during the period below.`,
        rows,
        badge: 'Approved',
        accent: '#0D9488',
      }
    );
  } catch (error) {
    console.error('approveRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Reject a request
// @route   POST /api/substitutions/:id/reject
// @access  Private/CEO,Admin
exports.rejectRequest = async (req, res) => {
  try {
    const { note } = req.body;
    const request = await SubstitutionRequest.findById(req.params.id)
      .populate('raisedBy', 'name role')
      .populate('subject', 'name role');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }
    if (req.user.role === 'ceo' && String(request.raisedBy._id || request.raisedBy) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'A CEO-raised request must be handled by the Admin.' });
    }

    const decidedAt = new Date();
    request.status = 'rejected';
    request.approvedBy = req.user._id;
    request.decisionAt = decidedAt;
    request.decisionNote = (note || '').trim();
    request.decidedBy = decisionOf(req.user, 'rejected', decidedAt);
    await request.save();

    const populated = await populateRequest(SubstitutionRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'substitution',
      entityId: request._id,
      entityLabel: `Substitution · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.subject,
      actor: req.user,
      action: 'rejected',
      note: request.decisionNote,
      at: decidedAt,
    });

    // Tell the raiser it was declined.
    dispatch(
      [String(request.raisedBy._id || request.raisedBy)],
      {
        type: 'substitution_rejected',
        title: '❌ Substitution Request Rejected',
        body: `Your substitution request was rejected${request.decisionNote ? `: "${request.decisionNote}"` : '.'}`,
        data: { requestId: String(request._id), status: 'rejected' },
      },
      {
        subject: 'Substitution Request Rejected',
        title: 'Substitution Request Rejected',
        intro: 'Your substitution request has been reviewed and was not approved.',
        rows: [
          { label: 'Decision', value: 'Rejected' },
          { label: 'Reviewed by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
          { label: 'Remark', value: request.decisionNote || '—' },
        ],
        badge: 'Rejected',
        accent: '#dc2626',
      }
    );
  } catch (error) {
    console.error('rejectRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Cancel a pending request (raiser withdraws it)
// @route   POST /api/substitutions/:id/cancel
// @access  Private (raiser or Admin)
exports.cancelRequest = async (req, res) => {
  try {
    const request = await SubstitutionRequest.findById(req.params.id).populate('subject', 'name role');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const isOwner = String(request.raisedBy) === String(req.user._id);
    if (!isOwner && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this request' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Only pending requests can be cancelled (this one is ${request.status})` });
    }

    const decidedAt = new Date();
    request.status = 'cancelled';
    request.decisionAt = decidedAt;
    request.decidedBy = decisionOf(req.user, 'cancelled', decidedAt);
    await request.save();

    res.status(200).json({ success: true, data: request });

    trail({
      entityType: 'substitution',
      entityId: request._id,
      entityLabel: `Substitution · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.subject,
      actor: req.user,
      action: 'cancelled',
      at: decidedAt,
    });
  } catch (error) {
    console.error('cancelRequest error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
