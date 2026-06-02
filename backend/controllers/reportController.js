const VisitReport = require('../models/VisitReport');
const Notification = require('../models/Notification');
const User = require('../models/User');

const REPORT_FIELDS = [
  'trainerId',
  'schoolId',
  'dateOfInspection',
  'personMet',
  'discussionContext',
];

const notifyChairmanForApproval = async (report, senderId) => {
  const chairman = await User.findOne({ role: 'chairman', schoolId: report.schoolId });
  if (!chairman) return;

  await Notification.create({
    recipientId: chairman._id,
    senderId,
    title: 'New Visit Report Pending Approval',
    message: 'A new visit report requires your approval.',
    type: 'report_approval',
    relatedId: report._id,
  });
};

exports.getReports = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'chairman') {
      // Chairman sees reports for their school
      query.schoolId = req.user.schoolId;
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
      .populate('trainerId', 'name');
      
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
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const report = await VisitReport.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Send notification back to TL
    await Notification.create({
      recipientId: report.teamLeaderId,
      senderId: req.user.id,
      title: `Visit Report ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: `Your visit report has been ${status} by the chairman.`,
      type: 'report_status_update',
      relatedId: report._id
    });

    // If approved, notify admins
    if (status === 'approved') {
      const admins = await User.find({ role: 'creator_admin' });
      for (const admin of admins) {
        await Notification.create({
          recipientId: admin._id,
          senderId: req.user.id,
          title: 'New Visit Report Approved',
          message: `A visit report was approved by the chairman and is now visible.`,
          type: 'general',
          relatedId: report._id
        });
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

    if (report.teamLeaderId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this report' });
    }

    const previousStatus = report.status;
    REPORT_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        report[field] = req.body[field];
      }
    });

    if (previousStatus === 'approved' || previousStatus === 'rejected') {
      report.status = 'pending';
      await report.save();
      await notifyChairmanForApproval(report, req.user.id);
    } else {
      await report.save();
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

    await Notification.deleteMany({ relatedId: report._id });
    await report.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
