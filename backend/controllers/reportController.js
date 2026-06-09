const VisitReport = require('../models/VisitReport');
const User = require('../models/User');
const { sendPushNotification } = require('../utils/pushNotification');

const REPORT_FIELDS = [
  'trainerId',
  'schoolId',
  'dateOfInspection',
  'personMet',
  'discussionContext',
];

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
    } else if (req.user.role === 'team_leader') {
      query.teamLeaderId = req.user.id;
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
    req.body.teamLeaderId = req.user.id;
    req.body.status = 'pending'; // Default status
    
    const report = await VisitReport.create(req.body);

    // Send notification to the chairman of that school
    await notifyChairmanForApproval(report, req.user.id);

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateReportStatus = async (req, res) => {
  try {
    const { status, rejectionRemark } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const report = await VisitReport.findByIdAndUpdate(
      req.params.id,
      { status, rejectionRemark },
      { new: true, runValidators: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Send notification back to TL
    let msg = `Your visit report has been ${status} by the chairman.`;
    if (status === 'rejected' && rejectionRemark) {
      msg += ` Remark: "${rejectionRemark}"`;
    }
    const tlTitle = `Visit Report ${status.charAt(0).toUpperCase() + status.slice(1)}`;

    const tl = await User.findById(report.teamLeaderId);
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
          await sendPushNotification(admin.expoPushToken, adminTitle, adminMsg, { type: 'general', relatedId: report._id.toString() });
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
    REPORT_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        report[field] = req.body[field];
      }
    });

    if (req.body.status !== undefined && ['pending', 'approved', 'rejected'].includes(req.body.status)) {
      report.status = req.body.status;
    }

    if (req.body.rejectionRemark !== undefined) {
      report.rejectionRemark = req.body.rejectionRemark;
    }

    await report.save();

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
            await sendPushNotification(admin.expoPushToken, adminTitle, adminMsg, { type: 'general', relatedId: report._id.toString() });
          }
        }
      }
    } else if (previousStatus === 'approved' || previousStatus === 'rejected') {
      if (isTL) {
        report.status = 'pending';
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

    await report.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
