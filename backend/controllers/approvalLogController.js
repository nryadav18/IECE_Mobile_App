const mongoose = require('mongoose');
const ApprovalLog = require('../models/ApprovalLog');
const { APPROVAL_ENTITY_TYPES, APPROVAL_ACTIONS } = ApprovalLog;
const { ADMIN_ROLES } = require('../utils/roles');

// Filters arrive straight from a query string. Anything that is not a valid id
// is ignored rather than handed to Mongoose, which would throw a CastError and
// turn a mistyped URL into a 500.
const asId = (v) => (v && mongoose.isValidObjectId(v) ? v : null);

/**
 * The Approval Log: every decision taken anywhere in the app, newest first,
 * filterable by who took it.
 *
 * This is the screen the whole feature exists for. "Approved by" on each card
 * answers the question one item at a time; this answers it the other way round —
 * show me everything a given admin has decided, or everything decided this week.
 *
 * Admin and CEO only. The route layer enforces it and so does every handler
 * here, because the log is the one place where the entire decision history of
 * the organisation sits in a single collection.
 */

const isViewer = (user) => ADMIN_ROLES.includes(user?.role);

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// @desc    Paginated decision history
// @route   GET /api/approval-log
// @access  Private/Admin,CEO
//
// Query: entityType, action, actorId, subjectId, from, to, search, page, limit
exports.getApprovalLog = async (req, res) => {
  try {
    if (!isViewer(req.user)) {
      return res.status(403).json({ success: false, message: 'The approval log is available to the Admin and CEO only.' });
    }

    const {
      entityType,
      action,
      actorId,
      subjectId,
      from,
      to,
      search,
      page = 1,
      limit = DEFAULT_LIMIT,
    } = req.query;

    const query = {};
    if (entityType && APPROVAL_ENTITY_TYPES.includes(entityType)) query.entityType = entityType;
    if (action && APPROVAL_ACTIONS.includes(action)) query.action = action;
    if (asId(actorId)) query.actorId = actorId;
    if (asId(subjectId)) query.subjectId = subjectId;

    if (from || to) {
      query.decidedAt = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) query.decidedAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        // `to` is a calendar day from a date picker — include the whole of it.
        if (!isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          query.decidedAt.$lte = d;
        }
      }
      if (!Object.keys(query.decidedAt).length) delete query.decidedAt;
    }

    // Free-text over the denormalised names — no joins needed, which is the
    // whole reason those names are stored on the row.
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ actorName: rx }, { subjectName: rx }, { entityLabel: rx }, { schoolName: rx }];
    }

    const perPage = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const current = Math.max(1, parseInt(page, 10) || 1);

    const [rows, total] = await Promise.all([
      ApprovalLog.find(query)
        .sort({ decidedAt: -1 })
        .skip((current - 1) * perPage)
        .limit(perPage)
        .lean(),
      ApprovalLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: rows,
      page: current,
      limit: perPage,
      total,
      hasMore: current * perPage < total,
    });
  } catch (error) {
    console.error('getApprovalLog error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Everyone who has ever decided something, with how much they decided.
//          Drives the "filter by approver" picker.
// @route   GET /api/approval-log/approvers
// @access  Private/Admin,CEO
exports.getApprovers = async (req, res) => {
  try {
    if (!isViewer(req.user)) {
      return res.status(403).json({ success: false, message: 'The approval log is available to the Admin and CEO only.' });
    }

    const rows = await ApprovalLog.aggregate([
      // Every real decision has an actor; a null one would become an
      // un-filterable "Unknown" chip on the client.
      { $match: { actorId: { $ne: null } } },
      // Newest first, so $first below picks the approver's most recent name and
      // role rather than an arbitrary one.
      { $sort: { decidedAt: -1 } },
      {
        $group: {
          _id: '$actorId',
          name: { $first: '$actorName' },
          role: { $first: '$actorRole' },
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $in: ['$action', ['approved', 'granted', 'auto_approved']] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$action', 'rejected'] }, 1, 0] } },
          lastDecidedAt: { $max: '$decidedAt' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('getApprovers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    The decision history of ONE item, for its detail screen
// @route   GET /api/approval-log/:entityType/:entityId
// @access  Private/Admin,CEO
exports.getEntityTrail = async (req, res) => {
  try {
    if (!isViewer(req.user)) {
      return res.status(403).json({ success: false, message: 'The approval log is available to the Admin and CEO only.' });
    }

    const { entityType, entityId } = req.params;
    if (!APPROVAL_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ success: false, message: 'Unknown approval type' });
    }
    if (!asId(entityId)) {
      return res.status(400).json({ success: false, message: 'Invalid item id' });
    }

    const rows = await ApprovalLog.find({ entityType, entityId })
      .sort({ decidedAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('getEntityTrail error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Headline counts for the top of the Approval Log screen
// @route   GET /api/approval-log/summary
// @access  Private/Admin,CEO
exports.getApprovalSummary = async (req, res) => {
  try {
    if (!isViewer(req.user)) {
      return res.status(403).json({ success: false, message: 'The approval log is available to the Admin and CEO only.' });
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [byType, byAction, recentTotal, total] = await Promise.all([
      ApprovalLog.aggregate([
        { $match: { decidedAt: { $gte: since } } },
        { $group: { _id: '$entityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ApprovalLog.aggregate([
        { $match: { decidedAt: { $gte: since } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ApprovalLog.countDocuments({ decidedAt: { $gte: since } }),
      ApprovalLog.estimatedDocumentCount(),
    ]);

    res.status(200).json({
      success: true,
      data: { byType, byAction, last30Days: recentTotal, total },
    });
  } catch (error) {
    console.error('getApprovalSummary error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.APPROVAL_ENTITY_TYPES = APPROVAL_ENTITY_TYPES;
