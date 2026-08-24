const VisitReport = require('../models/VisitReport');
const User = require('../models/User');
const { HEAD_ROLES, LEADER_ROLES } = require('../utils/roles');
const { sendPushNotification } = require('../utils/pushNotification');
const { decisionOf, trail } = require('../utils/approvalTrail');
const { trackChanges } = require('../utils/changeSummary');

const REPORT_FIELDS = [
  'trainerId',
  'schoolId',
  'dateOfInspection',
  'personMet',
  'discussionContext',
];

// Derive the legacy summary fields from the full form so existing list/detail
// views (chairman feed, cards) keep rendering meaningful data.
const deriveLegacyFields = (form = {}) => ({
  dateOfInspection: form.dateOfVisit || Date.now(),
  personMet: form.schoolAuthority || form.trainersName || 'N/A',
  discussionContext: form.authorityFeedback || form.issuesAcademics || 'See full visit report',
});

const notifyChairmanForApproval = async (report, senderId) => {
  const School = require('../models/School');
  const school = await School.findById(report.schoolId);
  if (!school || !school.chairmanId) return;

  const chairman = await User.findById(school.chairmanId);
  if (!chairman) return;

  const title = 'New Visit Report Pending Approval';
  const message = 'A new visit report requires your approval.';

  if (chairman.expoPushToken) {
    await sendPushNotification(chairman.expoPushToken, title, message, { type: 'report_approval', relatedId: report._id.toString() });
  }
};

exports.getReports = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'chairman') {
      const School = require('../models/School');
      const schools = await School.find({ chairmanId: req.user.id });
      const schoolIds = schools.map(s => s._id);
      query.schoolId = { $in: schoolIds };
    } else if (LEADER_ROLES.includes(req.user.role)) {
      // A (trainee) team leader sees the reports they authored.
      query.teamLeaderId = req.user.id;
    } else if (HEAD_ROLES.includes(req.user.role)) {
      // A head sees the reports they authored PLUS any report about a member of
      // the teams they oversee (so they see what their leaders logged too).
      const memberIds = await User.find({ teamId: { $in: req.user.teamIds || [] } }).distinct('_id');
      query.$or = [
        { teamLeaderId: req.user.id },
        { trainerId: { $in: memberIds } },
      ];
    } else if (req.user.role === 'creator_admin') {
      // Admin sees all reports, so no status filter is applied here
    }

    const reports = await VisitReport.find(query)
      .populate('teamLeaderId', 'name')
      .populate({
        path: 'schoolId',
        select: 'name chairmanId',
        populate: { path: 'chairmanId', select: 'name' }
      })
      .populate('trainerId', 'name')
      .sort('-dateOfInspection -createdAt');
      
    res.status(200).json({ success: true, count: reports.length, data: reports });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createReport = async (req, res) => {
  try {
    const { trainerId, schoolId, form = {} } = req.body;
    if (!trainerId || !schoolId) {
      return res.status(400).json({ success: false, error: 'A target person and school are required' });
    }

    const legacy = deriveLegacyFields(form);
    const report = await VisitReport.create({
      teamLeaderId: req.user.id,
      trainerId,
      schoolId,
      form,
      ...legacy,
      status: 'pending',
    });

    // Send notification to the chairman of that school
    await notifyChairmanForApproval(report, req.user.id);

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateReportStatus = async (req, res) => {
  try {
    const { status, rejectionRemark, feedback } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    // The reviewing authority's feedback/comment is mandatory for either action.
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ success: false, error: 'Feedback on the report is required' });
    }
    if (status === 'rejected' && (!rejectionRemark || !rejectionRemark.trim())) {
      return res.status(400).json({ success: false, error: 'A reason for rejection is required' });
    }

    const decidedAt = new Date();
    const report = await VisitReport.findByIdAndUpdate(
      req.params.id,
      {
        status,
        rejectionRemark,
        chairmanFeedback: feedback.trim(),
        decisionAt: decidedAt,
        decidedBy: decisionOf(req.user, status, decidedAt),
      },
      { returnDocument: 'after', runValidators: true }
    ).populate('teamLeaderId', 'name role');

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    trail({
      entityType: 'visit_report',
      entityId: report._id,
      entityLabel: `Visit report · ${report.personMet || ''}`.trim(),
      subject: report.teamLeaderId,
      actor: req.user,
      action: status,
      note: status === 'rejected' ? rejectionRemark || '' : feedback.trim(),
      school: report.schoolId,
      at: decidedAt,
    });

    // Send notification back to TL
    let msg = `Your visit report has been ${status} by the chairman.`;
    if (status === 'rejected' && rejectionRemark) {
      msg += ` Remark: "${rejectionRemark}"`;
    }
    const tlTitle = `Visit Report ${status.charAt(0).toUpperCase() + status.slice(1)}`;

    // teamLeaderId is populated above (name/role only), so re-fetch the full
    // user by id for the push token.
    const tl = await User.findById(report.teamLeaderId?._id || report.teamLeaderId);
    if (tl && tl.expoPushToken) {
      await sendPushNotification(tl.expoPushToken, tlTitle, msg, { type: 'report_status_update', relatedId: report._id.toString() });
    }

    // If approved, notify admins
    if (status === 'approved') {
      const admins = await User.find({ role: 'creator_admin' });
      const adminTitle = 'New Visit Report Approved';
      const adminMsg = `A visit report was approved by the chairman and is now visible.`;
      for (const admin of admins) {
        if (admin.expoPushToken) {
          await sendPushNotification(admin.expoPushToken, adminTitle, adminMsg, { type: 'admin_report', relatedId: report._id.toString() });
        }
      }
    }

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateReport = async (req, res) => {
  try {
    const report = await VisitReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    const isTL = report.teamLeaderId.toString() === req.user.id;
    const School = require('../models/School');
    const school = await School.findById(report.schoolId);
    const isChairman = req.user.role === 'chairman' && school && school.chairmanId.toString() === req.user.id;

    if (!isTL && !isChairman) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this report' });
    }

    const previousStatus = report.status;
    // Snapshot before the field loop mutates the document in place.
    const before = {
      dateOfInspection: report.dateOfInspection,
      personMet: report.personMet,
      discussionContext: report.discussionContext,
      formTouched: false,
    };
    REPORT_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        report[field] = req.body[field];
      }
    });

    // Full-form edit: replace the form and re-derive the legacy summary fields.
    if (req.body.form !== undefined) {
      report.form = req.body.form;
      report.markModified('form');
      const legacy = deriveLegacyFields(req.body.form);
      report.dateOfInspection = legacy.dateOfInspection;
      report.personMet = legacy.personMet;
      report.discussionContext = legacy.discussionContext;
    }

    const decidedAt = new Date();
    if (req.body.status !== undefined && ['pending', 'approved', 'rejected'].includes(req.body.status)) {
      report.status = req.body.status;
      // This route can decide a report too, so it has to record the decider —
      // otherwise an approval made from the edit screen stays anonymous while
      // the same approval made from the review screen does not.
      if (req.body.status === 'pending') {
        report.decidedBy = null;
        report.decisionAt = null;
      } else if (req.body.status !== previousStatus) {
        report.decidedBy = decisionOf(req.user, req.body.status, decidedAt);
        report.decisionAt = decidedAt;
      }
    }

    if (req.body.rejectionRemark !== undefined) {
      report.rejectionRemark = req.body.rejectionRemark;
    }

    await report.save();

    // The content edit is a separate fact from the decision, and only one of
    // the two was being recorded. A report re-written after it was approved is
    // exactly the case someone would come looking for.
    const changes = trackChanges()
      .field('inspection date', before.dateOfInspection, report.dateOfInspection)
      .field('person met', before.personMet, report.personMet)
      .field('discussion', before.discussionContext, report.discussionContext);
    if (req.body.form !== undefined) changes.note('the report form was re-submitted');
    if (changes.changed) {
      trail({
        entityType: 'visit_report',
        entityId: report._id,
        entityLabel: `Visit report · ${report.personMet || ''}`.trim(),
        subject: { _id: report.teamLeaderId },
        actor: req.user,
        action: 'updated',
        note: changes.summary()
          + (previousStatus !== 'pending' && req.body.status === undefined
            ? ` (the report was already ${previousStatus})`
            : ''),
        school: report.schoolId,
      });
    }

    if (req.body.status && req.body.status !== previousStatus && req.body.status !== 'pending') {
      trail({
        entityType: 'visit_report',
        entityId: report._id,
        entityLabel: `Visit report · ${report.personMet || ''}`.trim(),
        subject: { _id: report.teamLeaderId },
        actor: req.user,
        action: req.body.status,
        note: req.body.rejectionRemark || '',
        school: report.schoolId,
        at: decidedAt,
      });
    }

    if (req.body.status && req.body.status !== previousStatus) {
      // Send notification back to TL
      let msg = `Your visit report has been ${req.body.status} by the chairman.`;
      if (req.body.status === 'rejected' && req.body.rejectionRemark) {
        msg += ` Remark: "${req.body.rejectionRemark}"`;
      }
      const tlTitle = `Visit Report ${req.body.status.charAt(0).toUpperCase() + req.body.status.slice(1)}`;

      const tl = await User.findById(report.teamLeaderId);
      if (tl && tl.expoPushToken) {
        await sendPushNotification(tl.expoPushToken, tlTitle, msg, { type: 'report_status_update', relatedId: report._id.toString() });
      }

      // If approved, notify admins
      if (req.body.status === 'approved') {
        const admins = await User.find({ role: 'creator_admin' });
        const adminTitle = 'New Visit Report Approved';
        const adminMsg = `A visit report was approved by the chairman and is now visible.`;
        for (const admin of admins) {
          if (admin.expoPushToken) {
            await sendPushNotification(admin.expoPushToken, adminTitle, adminMsg, { type: 'admin_report', relatedId: report._id.toString() });
          }
        }
      }
    } else if (previousStatus === 'approved' || previousStatus === 'rejected') {
      if (isTL) {
        // Back into the queue as a fresh report — the previous decision was on a
        // version that no longer exists, so its approver goes with it.
        report.status = 'pending';
        report.decidedBy = null;
        report.decisionAt = null;
        await report.save();
        await notifyChairmanForApproval(report, req.user.id);
      }
    }

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteReport = async (req, res) => {
  try {
    const report = await VisitReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (report.teamLeaderId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this report' });
    }

    // Snapshot while it still exists — the label is unrecoverable afterwards.
    const snapshot = {
      _id: report._id,
      personMet: report.personMet,
      status: report.status,
      teamLeaderId: report.teamLeaderId,
      schoolId: report.schoolId,
    };

    await report.deleteOne();

    res.status(200).json({ success: true, data: {} });

    trail({
      entityType: 'visit_report',
      entityId: snapshot._id,
      entityLabel: `Visit report · ${snapshot.personMet || ''}`.trim(),
      subject: { _id: snapshot.teamLeaderId },
      actor: req.user,
      action: 'deleted',
      note: `Visit report deleted (was ${snapshot.status}).`,
      school: snapshot.schoolId,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
