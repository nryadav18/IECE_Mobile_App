const SchoolVisitRequest = require('../models/SchoolVisitRequest');
const LeaveRequest = require('../models/LeaveRequest');
const SubstitutionRequest = require('../models/SubstitutionRequest');
const School = require('../models/School');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { sendSchoolVisitEmail } = require('../utils/email');
const {
  getAdminOnlyRecipientIds,
  getSchoolVisitApprovalRecipientIds,
} = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { findOverlappingVisit } = require('../utils/schoolVisitStatus');
const { decisionOf, trail } = require('../utils/approvalTrail');

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

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const dayCount = (from, to) => {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

/**
 * Fan a school-visit event out to a set of recipients: one persisted inbox
 * notification + live push (via notify()), and a branded email to everyone who
 * has an email on file. Never throws — delivery is best-effort and must not
 * fail the HTTP response that already went out.
 */
const dispatch = async (recipientIds, inbox, email) => {
  const ids = [...new Set((recipientIds || []).map(String))];
  if (ids.length === 0) return;

  notify(ids, inbox).catch((e) => console.error('School visit notify error:', e.message));

  if (!email) return;
  try {
    const users = await User.find({ _id: { $in: ids } }).select('email name');
    await Promise.all(
      users
        .filter((u) => u.email)
        .map((u) =>
          sendSchoolVisitEmail(u.email, email).catch((e) =>
            console.error(`School visit email error (${u.email}):`, e.message)
          )
        )
    );
  } catch (e) {
    console.error('School visit email fan-out error:', e.message);
  }
};

// Shape a request for API responses (populated).
const populateRequest = (query) =>
  query
    .populate('applicant', 'name role email teamId teamIds teamLeaderId')
    .populate('school', 'name state')
    .populate('reviewedBy', 'name role')
    .populate('dateHistory.changedBy', 'name role');

const isAdmin = (role) => role === 'creator_admin';

const sameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * Parse + validate a window the Admin is setting on someone else's visit, and
 * check it against everything that must not overlap it.
 *
 * The Admin is the authority here, so — unlike the applicant — they are NOT
 * held to "cannot start in the past". A visit already under way has a fromDate
 * behind us, and correcting or extending it is exactly what this is for.
 *
 * @returns {Promise<{error?: string, from?: Date, to?: Date}>}
 */
const resolveAdminWindow = async (request, rawFrom, rawTo) => {
  const from = rawFrom ? new Date(rawFrom) : new Date(request.fromDate);
  const to = rawTo ? new Date(rawTo) : new Date(request.toDate);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { error: 'Invalid dates provided' };
  }
  if (startOfDay(from) > startOfDay(to)) {
    return { error: 'The from-date cannot be after the to-date' };
  }

  const applicantId = request.applicant?._id || request.applicant;

  // Another visit of theirs.
  const overlapVisit = await findOverlappingVisit(applicantId, from, to, request._id);
  if (overlapVisit) {
    return { error: 'These dates overlap another school visit request for this person.' };
  }

  // Approved leave.
  const overlapLeave = await LeaveRequest.findOne({
    applicant: applicantId,
    status: 'approved',
    fromDate: { $lte: endOfDay(to) },
    toDate: { $gte: startOfDay(from) },
  });
  if (overlapLeave) {
    return {
      error: `This person has approved leave from ${formatDate(overlapLeave.fromDate)} to ${formatDate(overlapLeave.toDate)} which overlaps these dates.`,
    };
  }

  // Either side of a substitution.
  const overlapSub = await SubstitutionRequest.findOne({
    status: 'approved',
    $or: [{ subject: applicantId }, { substitute: applicantId }],
    approvedFromDate: { $lte: endOfDay(to) },
    approvedToDate: { $gte: startOfDay(from) },
  });
  if (overlapSub) {
    return { error: 'This person is part of an approved substitution that overlaps these dates.' };
  }

  return { from, to };
};

/**
 * Apply a window to a request, recording the change in dateHistory when it
 * actually moved. Extending toDate re-arms the Visit Report prompt: the visit
 * is no longer finished, so the nudge must wait for the new end date.
 *
 * Mutates `request`; the caller saves.
 */
const applyWindow = (request, from, to, actorId, phase) => {
  const prevFrom = new Date(request.fromDate);
  const prevTo = new Date(request.toDate);
  const changed = !sameDay(prevFrom, from) || !sameDay(prevTo, to);
  if (!changed) return false;

  request.dateHistory.push({
    fromDate: from,
    toDate: to,
    previousFromDate: prevFrom,
    previousToDate: prevTo,
    changedBy: actorId,
    changedAt: new Date(),
    phase,
  });

  request.fromDate = from;
  request.toDate = to;

  // The window now ends later than the day we already nudged about — the visit
  // is running again, so let the cron prompt once it truly finishes.
  if (request.reportPromptedAt && startOfDay(to) > startOfDay(prevTo)) {
    request.reportPromptedAt = null;
  }

  return true;
};

// ---------------------------------------------------------------------------
// Schools the applicant may pick from
// ---------------------------------------------------------------------------

// @desc    Schools selectable as a visit destination (all active schools —
//          an inspection may target any school in the org, not just your own)
// @route   GET /api/school-visits/schools
// @access  Private/Applicants + Admin
exports.getVisitSchools = async (req, res) => {
  try {
    const schools = await School.find({ isDeleted: { $ne: true } })
      .select('name state')
      .sort({ name: 1 });
    res.status(200).json({ success: true, data: schools });
  } catch (error) {
    console.error('getVisitSchools error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

// @desc    Raise a school visit request (self-service). Goes to the Admin only.
// @route   POST /api/school-visits
// @access  Private/Leaders + Heads
exports.raiseVisit = async (req, res) => {
  try {
    const { schoolId, reason, fromDate, toDate } = req.body;

    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'Please select the school you are visiting' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A detailed reason for the visit is required' });
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'Both a from-date and a to-date are required' });
    }

    const school = await School.findById(schoolId).select('name state isDeleted');
    if (!school || school.isDeleted) {
      return res.status(404).json({ success: false, message: 'Selected school not found' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid dates provided' });
    }
    if (startOfDay(from) > startOfDay(to)) {
      return res.status(400).json({ success: false, message: 'The from-date cannot be after the to-date' });
    }

    // A visit may start TODAY (inspections are short-notice) but never in the
    // past — backdating would silently rewrite attendance that already closed.
    if (startOfDay(from) < startOfDay()) {
      return res.status(400).json({
        success: false,
        message: 'A school visit cannot be raised for a past date. The earliest you can select is today.',
      });
    }

    // ---- Overlap guards: visit vs visit, vs approved leave, vs substitution ----
    const overlapVisit = await findOverlappingVisit(req.user._id, from, to);
    if (overlapVisit) {
      return res.status(409).json({
        success: false,
        message: 'You already have a school visit request that overlaps these dates.',
      });
    }

    const overlapLeave = await LeaveRequest.findOne({
      applicant: req.user._id,
      status: 'approved',
      fromDate: { $lte: endOfDay(to) },
      toDate: { $gte: startOfDay(from) },
    });
    if (overlapLeave) {
      return res.status(409).json({
        success: false,
        message: `You have approved leave from ${formatDate(overlapLeave.fromDate)} to ${formatDate(overlapLeave.toDate)} which overlaps these dates.`,
      });
    }

    // Either side of a substitution blocks a visit: if someone is covering for
    // you, your attendance is already paused; if you are the substitute, you
    // are expected at the school you are covering.
    const overlapSub = await SubstitutionRequest.findOne({
      status: 'approved',
      $or: [{ subject: req.user._id }, { substitute: req.user._id }],
      approvedFromDate: { $lte: endOfDay(to) },
      approvedToDate: { $gte: startOfDay(from) },
    });
    if (overlapSub) {
      return res.status(409).json({
        success: false,
        message: 'You are part of an approved substitution that overlaps these dates.',
      });
    }

    const request = await SchoolVisitRequest.create({
      applicant: req.user._id,
      school: school._id,
      reason: reason.trim(),
      fromDate: from,
      toDate: to,
      // Frozen copy of the original ask — the Admin may move the live window
      // later, and this keeps "what they requested" readable forever.
      requestedFromDate: from,
      requestedToDate: to,
      status: 'pending',
    });

    const populated = await populateRequest(SchoolVisitRequest.findById(request._id));
    res.status(201).json({ success: true, data: populated });

    // ---- Notify the Admin ONLY (in-app + push + email) ----
    const recipientIds = await getAdminOnlyRecipientIds();
    const rows = [
      { label: 'Staff', value: `${req.user.name} (${roleLabel(req.user.role)})` },
      { label: 'School to visit', value: school.name },
      { label: 'Reason', value: reason.trim() },
      { label: 'From', value: formatDate(from) },
      { label: 'To', value: formatDate(to) },
      { label: 'Duration', value: `${dayCount(from, to)} day(s)` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'school_visit_request',
        title: '🏫 New School Visit Request',
        body: `${req.user.name} requested a school visit to ${school.name} (${formatDate(from)} – ${formatDate(to)}).`,
        data: { requestId: String(request._id), status: 'pending' },
      },
      {
        subject: 'New School Visit Request — Action Required',
        title: 'School Visit Request Raised',
        intro: `${req.user.name} has requested to be out on a school visit and is awaiting your decision. Details are below.`,
        rows,
        badge: 'Pending Approval',
        accent: '#0D9488',
        footerNote: 'Once approved, their check-in and check-out is paused for these dates and the days are marked "On School Visit".',
      }
    );
  } catch (error) {
    console.error('raiseVisit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

// @desc    List school visit requests relevant to the caller
// @route   GET /api/school-visits?status=&mine=
// @access  Private/Applicants + Admin
exports.getVisits = async (req, res) => {
  try {
    const { role } = req.user;
    const query = {};
    const mine = String(req.query.mine) === 'true';

    if (mine || !isAdmin(role)) {
      // Applicants only ever see the requests they raised.
      query.applicant = req.user._id;
    }
    // Admin (mine !== true) sees every request — the approval queue + history.

    if (req.query.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    const requests = await populateRequest(SchoolVisitRequest.find(query)).sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    console.error('getVisits error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get a single school visit request
// @route   GET /api/school-visits/:id
// @access  Private (applicant or Admin)
exports.getVisit = async (req, res) => {
  try {
    const request = await populateRequest(SchoolVisitRequest.findById(req.params.id));
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const isOwner = String(request.applicant?._id || request.applicant) === String(req.user._id);
    if (!isAdmin(req.user.role) && !isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this request' });
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('getVisit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Approve / reject / cancel
// ---------------------------------------------------------------------------

// @desc    Approve a school visit request (Admin only). Takes effect at once —
//          from this moment the applicant's check-in/out is paused for the
//          window and those days show as "On School Visit".
//          The Admin may pass fromDate/toDate to adjust the window as part of
//          approving it; omitting them approves exactly what was requested.
// @route   POST /api/school-visits/:id/approve
// @access  Private/Admin
exports.approveVisit = async (req, res) => {
  try {
    const request = await SchoolVisitRequest.findById(req.params.id)
      .populate('applicant', 'name role email teamId teamIds teamLeaderId')
      .populate('school', 'name');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }

    // Optional adjust-then-approve.
    const { fromDate, toDate } = req.body || {};
    if (fromDate || toDate) {
      const win = await resolveAdminWindow(request, fromDate, toDate);
      if (win.error) return res.status(400).json({ success: false, message: win.error });
      applyWindow(request, win.from, win.to, req.user._id, 'pending');
    }

    const decidedAt = new Date();
    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.decisionAt = decidedAt;
    request.decisionNote = '';
    request.decidedBy = decisionOf(req.user, 'approved', decidedAt);
    await request.save();

    const populated = await populateRequest(SchoolVisitRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'school_visit',
      entityId: request._id,
      entityLabel: `School visit · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'approved',
      school: request.school,
      at: decidedAt,
    });

    // ---- Notify the applicant + their reporting line + CEO ----
    const applicant = request.applicant;
    const recipientIds = await getSchoolVisitApprovalRecipientIds(applicant);

    // Only surface the original ask when the Admin actually changed it.
    const windowAdjusted =
      !sameDay(request.requestedFromDate, request.fromDate) ||
      !sameDay(request.requestedToDate, request.toDate);

    const rows = [
      { label: 'Staff', value: `${applicant.name} (${roleLabel(applicant.role)})` },
      { label: 'School', value: request.school ? request.school.name : '' },
      { label: 'Reason', value: request.reason },
      ...(windowAdjusted
        ? [{ label: 'Originally requested', value: `${formatDate(request.requestedFromDate)} – ${formatDate(request.requestedToDate)}` }]
        : []),
      { label: 'From', value: formatDate(request.fromDate) },
      { label: 'To', value: formatDate(request.toDate) },
      { label: 'Duration', value: `${dayCount(request.fromDate, request.toDate)} day(s)` },
      { label: 'Approved by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'school_visit_approved',
        title: '✅ School Visit Approved',
        body: `${applicant.name}'s school visit to ${request.school ? request.school.name : 'a school'} (${formatDate(request.fromDate)} – ${formatDate(request.toDate)}) has been approved.`,
        data: { requestId: String(request._id), status: 'approved' },
      },
      {
        subject: 'School Visit Approved',
        title: 'School Visit Approved',
        intro: `${applicant.name}'s school visit has been approved by the Admin. These days are marked "On School Visit" and count as on-duty working days.`,
        rows,
        badge: 'Approved',
        accent: '#0D9488',
        footerNote: 'Check-in and check-out is paused for this period and resumes automatically the day after the visit ends.',
      }
    );
  } catch (error) {
    console.error('approveVisit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Change a school visit's date window (Admin only). Works while the
//          request is still pending AND after it has been approved.
//
//          Because the check-in pause, the calendar marks, the reminder-cron
//          exemption and the Visit Report prompt all derive from fromDate /
//          toDate at read time, saving the new window is all it takes for the
//          change to land everywhere:
//            - extending toDate keeps attendance paused for the extra days and
//              paints them "On School Visit";
//            - shortening it hands check-in / check-out straight back for the
//              days that dropped out of the window;
//            - if today falls outside the new window, the very next check-in
//              attempt succeeds — no cron, no cleanup job.
// @route   POST /api/school-visits/:id/dates
// @access  Private/Admin
exports.updateVisitDates = async (req, res) => {
  try {
    const { fromDate, toDate } = req.body || {};
    if (!fromDate && !toDate) {
      return res.status(400).json({ success: false, message: 'Provide a from-date and/or a to-date to change.' });
    }

    const request = await SchoolVisitRequest.findById(req.params.id)
      .populate('applicant', 'name role email teamId teamIds teamLeaderId')
      .populate('school', 'name');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Dates can only be changed while a request is pending or approved (this one is ${request.status}).`,
      });
    }

    const win = await resolveAdminWindow(request, fromDate, toDate);
    if (win.error) return res.status(400).json({ success: false, message: win.error });

    const previousFrom = new Date(request.fromDate);
    const previousTo = new Date(request.toDate);
    const changed = applyWindow(request, win.from, win.to, req.user._id, request.status);

    if (!changed) {
      const populatedSame = await populateRequest(SchoolVisitRequest.findById(request._id));
      return res.status(200).json({ success: true, data: populatedSame, changed: false });
    }

    // Whoever approved the visit no longer owns the dates that are now in force,
    // so the snapshot moves to the Admin who set them.
    const decidedAt = new Date();
    if (request.status === 'approved') {
      request.decidedBy = decisionOf(req.user, 'revised', decidedAt);
    }

    await request.save();

    const populated = await populateRequest(SchoolVisitRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated, changed: true });

    trail({
      entityType: 'school_visit',
      entityId: request._id,
      entityLabel: `School visit · ${formatDate(win.from)} – ${formatDate(win.to)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'revised',
      note: `Dates changed from ${formatDate(previousFrom)} – ${formatDate(previousTo)}`,
      school: request.school,
      at: decidedAt,
    });

    // A pending request has not been announced to anyone yet — the applicant
    // will see the final window when it is approved, so silently adjusting it
    // is not worth a notification. An APPROVED visit is different: people are
    // already planning around those dates, so a change has to be announced.
    if (request.status !== 'approved') return;

    const applicant = request.applicant;
    const recipientIds = await getSchoolVisitApprovalRecipientIds(applicant);
    const extended = startOfDay(win.to) > startOfDay(previousTo);

    const rows = [
      { label: 'Staff', value: `${applicant.name} (${roleLabel(applicant.role)})` },
      { label: 'School', value: request.school ? request.school.name : '' },
      { label: 'Previous period', value: `${formatDate(previousFrom)} – ${formatDate(previousTo)}` },
      { label: 'New period', value: `${formatDate(win.from)} – ${formatDate(win.to)}` },
      { label: 'Duration', value: `${dayCount(win.from, win.to)} day(s)` },
      { label: 'Changed by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'school_visit_updated',
        title: '📅 School Visit Dates Changed',
        body: `${applicant.name}'s school visit is now ${formatDate(win.from)} – ${formatDate(win.to)}${extended ? ' (extended)' : ''}.`,
        data: { requestId: String(request._id), status: 'approved' },
      },
      {
        subject: 'School Visit Dates Changed',
        title: 'School Visit Dates Changed',
        intro: `The Admin has changed the dates of ${applicant.name}'s approved school visit. The updated period is below.`,
        rows,
        badge: 'Updated',
        accent: '#0D9488',
        footerNote: extended
          ? 'Check-in and check-out stay paused for the extended period and resume automatically the day after the new end date.'
          : 'Check-in and check-out resume automatically for any days no longer covered by the visit.',
      }
    );
  } catch (error) {
    console.error('updateVisitDates error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Reject a school visit request with a mandatory reason (Admin only)
// @route   POST /api/school-visits/:id/reject
// @access  Private/Admin
exports.rejectVisit = async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, message: 'A reason for rejection is required' });
    }

    const request = await SchoolVisitRequest.findById(req.params.id)
      .populate('applicant', 'name role email')
      .populate('school', 'name');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This request is already ${request.status}` });
    }

    const decidedAt = new Date();
    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    request.decisionAt = decidedAt;
    request.decisionNote = note.trim();
    request.decidedBy = decisionOf(req.user, 'rejected', decidedAt);
    await request.save();

    const populated = await populateRequest(SchoolVisitRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'school_visit',
      entityId: request._id,
      entityLabel: `School visit · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'rejected',
      note: request.decisionNote,
      school: request.school,
      at: decidedAt,
    });

    // Tell the applicant it was declined, with the reason. No one else.
    dispatch(
      [String(request.applicant._id || request.applicant)],
      {
        type: 'school_visit_rejected',
        title: '❌ School Visit Rejected',
        body: `Your school visit request was rejected: "${request.decisionNote}"`,
        data: { requestId: String(request._id), status: 'rejected' },
      },
      {
        subject: 'School Visit Request Rejected',
        title: 'School Visit Request Rejected',
        intro: 'Your school visit request has been reviewed by the Admin and was not approved. Your normal attendance continues as usual.',
        rows: [
          { label: 'School', value: request.school ? request.school.name : '' },
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
    console.error('rejectVisit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Withdraw a pending school visit request (applicant) — or cancel it (Admin)
// @route   POST /api/school-visits/:id/cancel
// @access  Private (applicant or Admin)
exports.cancelVisit = async (req, res) => {
  try {
    const request = await SchoolVisitRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const isOwner = String(request.applicant) === String(req.user._id);
    if (!isOwner && !isAdmin(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this request' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Only pending requests can be withdrawn (this one is ${request.status})` });
    }

    const decidedAt = new Date();
    request.status = 'cancelled';
    request.decisionAt = decidedAt;
    request.decidedBy = decisionOf(req.user, 'cancelled', decidedAt);
    await request.save();

    res.status(200).json({ success: true, data: request });

    trail({
      entityType: 'school_visit',
      entityId: request._id,
      entityLabel: `School visit · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'cancelled',
      at: decidedAt,
    });
  } catch (error) {
    console.error('cancelVisit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
