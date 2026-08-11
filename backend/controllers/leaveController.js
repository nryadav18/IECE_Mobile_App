const LeaveRequest = require('../models/LeaveRequest');
const SchoolVisitRequest = require('../models/SchoolVisitRequest');
const SubstitutionRequest = require('../models/SubstitutionRequest');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { sendLeaveEmail } = require('../utils/email');
const {
  getAdminOnlyRecipientIds,
  getLeaveApprovalRecipientIds,
} = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { FIELD_STAFF } = require('../utils/roles');
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

// Same calendar day? Used to tell a real date change from a no-op edit.
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

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
    .populate('reviewedBy', 'name role')
    .populate('raisedBy', 'name role')
    .populate('dateHistory.changedBy', 'name role');

const isAdmin = (role) => role === 'creator_admin';

// End-of-day for a given date — the other half of startOfDay, used when a stored
// timestamp has to be compared against a whole calendar day.
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/**
 * Everything already booked for `userId` that overlaps [from, to].
 *
 * Used only by the Admin's emergency-leave and edit flows, which are allowed to
 * override a clash — so this REPORTS rather than blocks. Each entry is a short
 * human sentence the app can show verbatim in the confirmation dialog, because
 * "Ravi already has an approved leave 10–12 Aug" is a decision the Admin can
 * actually make, whereas "conflict detected" is not.
 *
 * `excludeLeaveId` skips the request being edited, so a leave never clashes with
 * itself.
 */
const findConflicts = async (userId, from, to, excludeLeaveId = null) => {
  const start = startOfDay(from);
  const end = endOfDay(to);

  const leaveQuery = {
    applicant: userId,
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lte: end },
    toDate: { $gte: start },
  };
  if (excludeLeaveId) leaveQuery._id = { $ne: excludeLeaveId };

  const [leaves, visits, substitutions, attendance] = await Promise.all([
    LeaveRequest.find(leaveQuery).sort({ fromDate: 1 }),
    SchoolVisitRequest.find({
      applicant: userId,
      status: { $in: ['pending', 'approved'] },
      fromDate: { $lte: end },
      toDate: { $gte: start },
    }).sort({ fromDate: 1 }),
    // Only APPROVED substitutions matter: they are the ones that already paint
    // the calendar and excuse the person from work.
    SubstitutionRequest.find({
      subject: userId,
      status: 'approved',
      approvedFromDate: { $lte: end },
      approvedToDate: { $gte: start },
    }).sort({ approvedFromDate: 1 }),
    Attendance.find({ trainerId: userId, date: { $gte: start, $lte: end } })
      .select('date status')
      .sort({ date: 1 }),
  ]);

  const conflicts = [];

  leaves.forEach((l) =>
    conflicts.push({
      type: 'leave',
      // Cancelling a pending request is safe; an approved one is a real decision
      // being undone, so the two are labelled differently on purpose.
      cancellable: l.status === 'pending',
      requestId: String(l._id),
      message: `${l.isEmergency ? 'An emergency leave' : `A ${l.status} leave request`} already covers ${formatDate(l.fromDate)} – ${formatDate(l.toDate)}.`,
    })
  );
  visits.forEach((v) =>
    conflicts.push({
      type: 'schoolVisit',
      cancellable: v.status === 'pending',
      requestId: String(v._id),
      message: `A ${v.status} school visit covers ${formatDate(v.fromDate)} – ${formatDate(v.toDate)}.`,
    })
  );
  substitutions.forEach((s) =>
    conflicts.push({
      type: 'substitution',
      cancellable: false,
      requestId: String(s._id),
      message: `Someone is already approved to substitute for them from ${formatDate(s.approvedFromDate)} to ${formatDate(s.approvedToDate)}.`,
    })
  );
  if (attendance.length) {
    conflicts.push({
      type: 'attendance',
      cancellable: false,
      message: `They already have ${attendance.length} attendance record(s) in this period (${attendance
        .slice(0, 3)
        .map((a) => formatDate(a.date))
        .join(', ')}${attendance.length > 3 ? '…' : ''}). Those days will be shown as On Leave instead.`,
    });
  }

  return conflicts;
};

/**
 * Stand down whatever the Admin chose to override: any PENDING leave or school
 * visit in the window is cancelled, so the person is not left holding a request
 * for days they have now been given off. Approved records and attendance are
 * deliberately left alone — the leave simply paints over them on the calendar.
 */
const cancelOverriddenRequests = async (conflicts, actor, note) => {
  const leaveIds = conflicts.filter((c) => c.type === 'leave' && c.cancellable).map((c) => c.requestId);
  const visitIds = conflicts.filter((c) => c.type === 'schoolVisit' && c.cancellable).map((c) => c.requestId);

  const at = new Date();
  const decided = decisionOf(actor, 'cancelled', at);

  await Promise.all([
    leaveIds.length
      ? LeaveRequest.updateMany(
          { _id: { $in: leaveIds }, status: 'pending' },
          { $set: { status: 'cancelled', decisionAt: at, reviewedBy: decided.userId, decisionNote: note, decidedBy: decided } }
        )
      : null,
    visitIds.length
      ? SchoolVisitRequest.updateMany(
          { _id: { $in: visitIds }, status: 'pending' },
          { $set: { status: 'cancelled', decisionAt: at, reviewedBy: decided.userId, decisionNote: note, decidedBy: decided } }
        )
      : null,
  ]);

  // Each stood-down request is its own decision — the Admin needs to be able to
  // see that a leave was cancelled by an override rather than by its owner.
  for (const c of conflicts.filter((x) => x.cancellable)) {
    trail({
      entityType: c.type === 'leave' ? 'leave' : 'school_visit',
      entityId: c.requestId,
      entityLabel: c.message || 'Superseded request',
      actor,
      action: 'cancelled',
      note,
      at,
    });
  }
};

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

    // Also block leave that collides with an approved school visit — otherwise
    // the same days would be both "on duty, off-site" and "excused absence",
    // and the calendar would have to pick one arbitrarily.
    const visitOverlap = await SchoolVisitRequest.findOne({
      applicant: req.user._id,
      status: { $in: ['pending', 'approved'] },
      fromDate: { $lte: to },
      toDate: { $gte: from },
    });
    if (visitOverlap) {
      return res.status(409).json({
        success: false,
        message: 'You have a school visit request that overlaps these dates.',
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
// Emergency leave (Admin grants a leave FOR someone else)
// ---------------------------------------------------------------------------

// @desc    Staff the Admin may grant an emergency leave to (all field staff)
// @route   GET /api/leaves/staff?search=&page=&limit=
// @access  Private/Admin
exports.getLeaveStaff = async (req, res) => {
  try {
    const filter = { role: { $in: FIELD_STAFF } };

    const search = (req.query.search || '').trim();
    if (search) filter.name = { $regex: search, $options: 'i' };

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

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
    console.error('getLeaveStaff error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Grant an emergency leave to a staff member (Admin only)
// @route   POST /api/leaves/emergency
// @access  Private/Admin
//
// Body: { applicantId, reason, fromDate, toDate, force? }
//
// Unlike a self-applied leave this is born APPROVED and carries NO date floor:
// the Admin may date it today, or backwards, to cover an absence that already
// happened. Anything already booked in the window is reported back as a 409 with
// a `conflicts` list; re-posting with `force: true` proceeds anyway and stands
// down whatever pending requests it supersedes.
exports.createEmergencyLeave = async (req, res) => {
  try {
    const { applicantId, reason, fromDate, toDate, force } = req.body;

    if (!applicantId) {
      return res.status(400).json({ success: false, message: 'Please select the staff member this leave is for' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason for the emergency leave is required' });
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

    const applicant = await User.findById(applicantId).select('name role email teamId teamIds teamLeaderId');
    if (!applicant) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }
    if (!FIELD_STAFF.includes(applicant.role)) {
      return res.status(400).json({
        success: false,
        message: 'Emergency leave can only be granted to field staff (trainers, team leaders and heads).',
      });
    }

    const conflicts = await findConflicts(applicant._id, from, to);
    if (conflicts.length && !force) {
      return res.status(409).json({
        success: false,
        requiresConfirmation: true,
        conflicts,
        message: `${applicant.name} already has something booked in this period.`,
      });
    }
    if (conflicts.length) {
      await cancelOverriddenRequests(
        conflicts,
        req.user,
        'Superseded by an emergency leave granted by the Admin.'
      );
    }

    const now = new Date();
    const request = await LeaveRequest.create({
      applicant: applicant._id,
      reason: reason.trim(),
      fromDate: from,
      toDate: to,
      proofs: [],
      // Nobody is left to approve it — the approver is the one raising it.
      status: 'approved',
      isEmergency: true,
      raisedBy: req.user._id,
      reviewedBy: req.user._id,
      decisionAt: now,
      decidedBy: decisionOf(req.user, 'granted', now),
    });

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(201).json({ success: true, data: populated, overrode: conflicts.length });

    trail({
      entityType: 'leave',
      entityId: request._id,
      entityLabel: `Emergency leave · ${formatDate(from)} – ${formatDate(to)}`,
      subject: applicant,
      actor: req.user,
      action: 'granted',
      note: reason.trim(),
      at: now,
    });

    // ---- Tell everyone the leave concerns, at once ----
    // Same recipients as an approved leave: the person themselves, their team
    // leader, the heads over their team, and the CEO.
    const recipientIds = await getLeaveApprovalRecipientIds(applicant);
    const rows = [
      { label: 'Staff', value: `${applicant.name} (${roleLabel(applicant.role)})` },
      { label: 'Reason', value: reason.trim() },
      { label: 'From', value: formatDate(from) },
      { label: 'To', value: formatDate(to) },
      { label: 'Duration', value: `${dayCount(from, to)} day(s)` },
      { label: 'Granted by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
    ];

    dispatch(
      recipientIds,
      {
        type: 'leave_emergency',
        title: '🚨 Emergency Leave Granted',
        body: `The Admin granted ${applicant.name} emergency leave (${formatDate(from)} – ${formatDate(to)}).`,
        data: { requestId: String(request._id), status: 'approved', emergency: 'true' },
      },
      {
        subject: 'Emergency Leave Granted',
        title: 'Emergency Leave Granted',
        intro: `The Admin has granted ${applicant.name} an emergency leave. It is already in effect — no approval is pending. Details are below.`,
        rows,
        badge: 'Emergency',
        accent: '#DC2626',
        footerNote: 'You are receiving this because you are part of this staff member’s reporting line.',
      }
    );
  } catch (error) {
    console.error('createEmergencyLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Edit dates (Admin)
// ---------------------------------------------------------------------------

// @desc    Change the window of a leave request, before OR after approval
// @route   POST /api/leaves/:id/dates
// @access  Private/Admin
//
// Body: { fromDate?, toDate?, force? }
//
// Editing a PENDING request also decides it: the Admin has just chosen the exact
// dates they are willing to grant, so making them press Approve afterwards would
// only be a second way to say the same thing. Editing an APPROVED leave extends
// or corrects it in place and keeps it approved.
//
// The Admin may move a leave anywhere, including into days that have passed —
// the same freedom emergency leave has, and for the same reason: correcting the
// record after the fact is the whole point of the feature.
exports.updateLeaveDates = async (req, res) => {
  try {
    const { fromDate, toDate, force } = req.body || {};
    if (!fromDate && !toDate) {
      return res.status(400).json({ success: false, message: 'Provide a from-date and/or a to-date to change.' });
    }

    const request = await LeaveRequest.findById(req.params.id)
      .populate('applicant', 'name role email teamId teamIds teamLeaderId');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Dates can only be changed while a request is pending or approved (this one is ${request.status}).`,
      });
    }

    const from = fromDate ? new Date(fromDate) : new Date(request.fromDate);
    const to = toDate ? new Date(toDate) : new Date(request.toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid dates provided' });
    }
    if (startOfDay(from) > startOfDay(to)) {
      return res.status(400).json({ success: false, message: 'The from-date cannot be after the to-date' });
    }

    const applicant = request.applicant;
    const conflicts = await findConflicts(applicant._id, from, to, request._id);
    if (conflicts.length && !force) {
      return res.status(409).json({
        success: false,
        requiresConfirmation: true,
        conflicts,
        message: `${applicant.name} already has something booked in this period.`,
      });
    }
    if (conflicts.length) {
      await cancelOverriddenRequests(
        conflicts,
        req.user,
        'Superseded by leave dates set by the Admin.'
      );
    }

    const previousFrom = new Date(request.fromDate);
    const previousTo = new Date(request.toDate);
    const wasPending = request.status === 'pending';
    const movedDates = !sameDay(previousFrom, from) || !sameDay(previousTo, to);

    if (movedDates) {
      request.dateHistory.push({
        fromDate: from,
        toDate: to,
        previousFromDate: previousFrom,
        previousToDate: previousTo,
        changedBy: req.user._id,
        changedAt: new Date(),
        phase: request.status,
      });
      request.fromDate = from;
      request.toDate = to;
    }

    // An edit IS the decision on a pending request.
    const decidedAt = new Date();
    if (wasPending) {
      request.status = 'approved';
      request.reviewedBy = req.user._id;
      request.decisionAt = decidedAt;
      request.decisionNote = '';
      request.decidedBy = decisionOf(req.user, 'approved', decidedAt);
    } else if (movedDates) {
      // Already approved and the Admin moved the window. Whoever originally
      // approved it no longer owns the dates that are now in force, so the
      // snapshot moves to the person who set them.
      request.decidedBy = decisionOf(req.user, 'revised', decidedAt);
    }

    if (!movedDates && !wasPending) {
      const unchanged = await populateRequest(LeaveRequest.findById(request._id));
      return res.status(200).json({ success: true, data: unchanged, changed: false });
    }

    await request.save();

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated, changed: true, approved: wasPending });

    trail({
      entityType: 'leave',
      entityId: request._id,
      entityLabel: `Leave · ${formatDate(from)} – ${formatDate(to)}`,
      subject: applicant,
      actor: req.user,
      action: wasPending ? 'approved' : 'revised',
      note: movedDates ? `Dates changed from ${formatDate(previousFrom)} – ${formatDate(previousTo)}` : '',
      at: decidedAt,
    });

    // A pending request that just became approved is an APPROVAL first and an
    // edit second: the reporting line has to hear about the leave itself, on the
    // same terms as any other approval. A change to an already-approved leave is
    // only a correction, so it goes to the person it actually affects.
    if (wasPending) {
      const recipientIds = await getLeaveApprovalRecipientIds(applicant);
      dispatch(
        recipientIds,
        {
          type: 'leave_approved',
          title: '✅ Leave Approved',
          body: `${applicant.name}'s leave (${formatDate(from)} – ${formatDate(to)}) has been approved.`,
          data: { requestId: String(request._id), status: 'approved' },
        },
        {
          subject: 'Leave Approved',
          title: 'Leave Approved',
          intro: `${applicant.name}'s leave request has been approved by the Admin${movedDates ? ' with adjusted dates' : ''}. Please plan accordingly for the period below.`,
          rows: [
            { label: 'Applicant', value: `${applicant.name} (${roleLabel(applicant.role)})` },
            ...(movedDates ? [{ label: 'Originally requested', value: `${formatDate(previousFrom)} – ${formatDate(previousTo)}` }] : []),
            { label: 'From', value: formatDate(from) },
            { label: 'To', value: formatDate(to) },
            { label: 'Duration', value: `${dayCount(from, to)} day(s)` },
            { label: 'Approved by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
          ],
          badge: 'Approved',
          accent: '#0D9488',
          footerNote: 'You are receiving this because you are part of this staff member’s reporting line.',
        }
      );
      return;
    }

    const extended = startOfDay(to) > startOfDay(previousTo);
    dispatch(
      [String(applicant._id)],
      {
        type: 'leave_updated',
        title: '📅 Leave Dates Changed',
        body: `Your leave is now ${formatDate(from)} – ${formatDate(to)}${extended ? ' (extended)' : ''}.`,
        data: { requestId: String(request._id), status: request.status },
      },
      {
        subject: 'Leave Dates Changed',
        title: 'Leave Dates Changed',
        intro: 'The Admin has changed the dates of your approved leave. The updated period is below.',
        rows: [
          { label: 'Previous period', value: `${formatDate(previousFrom)} – ${formatDate(previousTo)}` },
          { label: 'New period', value: `${formatDate(from)} – ${formatDate(to)}` },
          { label: 'Duration', value: `${dayCount(from, to)} day(s)` },
          { label: 'Changed by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
        ],
        badge: extended ? 'Extended' : 'Updated',
        accent: '#0D9488',
        footerNote: 'If this does not look right, please contact the Admin.',
      }
    );
  } catch (error) {
    console.error('updateLeaveDates error:', error);
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

    // The Admin's Emergency tab asks for `emergency=true` — the register of every
    // leave the Admin has granted on someone else's behalf. `emergency=false`
    // gives the mirror of that: only self-applied requests.
    if (req.query.emergency === 'true') query.isEmergency = true;
    else if (req.query.emergency === 'false') query.isEmergency = { $ne: true };

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

    const decidedAt = new Date();
    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.decisionAt = decidedAt;
    request.decisionNote = '';
    request.decidedBy = decisionOf(req.user, 'approved', decidedAt);
    await request.save();

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'leave',
      entityId: request._id,
      entityLabel: `Leave · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'approved',
      at: decidedAt,
    });

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

    const decidedAt = new Date();
    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    request.decisionAt = decidedAt;
    request.decisionNote = note.trim();
    request.decidedBy = decisionOf(req.user, 'rejected', decidedAt);
    await request.save();

    const populated = await populateRequest(LeaveRequest.findById(request._id));
    res.status(200).json({ success: true, data: populated });

    trail({
      entityType: 'leave',
      entityId: request._id,
      entityLabel: `Leave · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: 'rejected',
      note: request.decisionNote,
      at: decidedAt,
    });

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

// @desc    Cancel a pending leave request (applicant withdraws it), or withdraw
//          an emergency leave the Admin granted by mistake
// @route   POST /api/leaves/:id/cancel
// @access  Private (applicant or Admin)
exports.cancelLeave = async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id).populate('applicant', 'name role email');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const applicantId = String(request.applicant?._id || request.applicant);
    const isOwner = applicantId === String(req.user._id);
    const admin = isAdmin(req.user.role);
    if (!isOwner && !admin) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this request' });
    }

    // An emergency leave is born approved, so "only pending can be cancelled"
    // would leave one granted to the wrong person with no way back. The Admin who
    // can grant it can withdraw it; nobody else can, and the applicant cannot
    // withdraw a leave they never asked for.
    const adminWithdrawingEmergency = admin && request.isEmergency && request.status === 'approved';

    if (request.status !== 'pending' && !adminWithdrawingEmergency) {
      return res.status(400).json({ success: false, message: `Only pending requests can be cancelled (this one is ${request.status})` });
    }

    const decidedAt = new Date();
    request.status = 'cancelled';
    request.decisionAt = decidedAt;
    if (adminWithdrawingEmergency) {
      request.reviewedBy = req.user._id;
      request.decisionNote = 'Emergency leave withdrawn by the Admin.';
    }
    // Recorded for the applicant's own withdrawal too — "Cancelled by <the
    // applicant>" is exactly what distinguishes a request they pulled back from
    // one the Admin stood down.
    request.decidedBy = decisionOf(req.user, adminWithdrawingEmergency ? 'withdrawn' : 'cancelled', decidedAt);
    await request.save();

    res.status(200).json({ success: true, data: request });

    trail({
      entityType: 'leave',
      entityId: request._id,
      entityLabel: `Leave · ${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`,
      subject: request.applicant,
      actor: req.user,
      action: adminWithdrawingEmergency ? 'withdrawn' : 'cancelled',
      note: adminWithdrawingEmergency ? request.decisionNote : '',
      at: decidedAt,
    });

    if (adminWithdrawingEmergency) {
      // Everyone who was told it existed is told it is gone.
      const recipientIds = await getLeaveApprovalRecipientIds(request.applicant);
      dispatch(
        recipientIds,
        {
          type: 'leave_cancelled',
          title: '↩️ Emergency Leave Withdrawn',
          body: `The emergency leave for ${request.applicant?.name} (${formatDate(request.fromDate)} – ${formatDate(request.toDate)}) has been withdrawn.`,
          data: { requestId: String(request._id), status: 'cancelled' },
        },
        {
          subject: 'Emergency Leave Withdrawn',
          title: 'Emergency Leave Withdrawn',
          intro: `The Admin has withdrawn the emergency leave granted to ${request.applicant?.name}. Those days are no longer marked as leave.`,
          rows: [
            { label: 'From', value: formatDate(request.fromDate) },
            { label: 'To', value: formatDate(request.toDate) },
            { label: 'Withdrawn by', value: `${req.user.name} (${roleLabel(req.user.role)})` },
          ],
          badge: 'Withdrawn',
          accent: '#DC2626',
          footerNote: 'If you have questions, please reach out to the Admin.',
        }
      );
    }
  } catch (error) {
    console.error('cancelLeave error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
