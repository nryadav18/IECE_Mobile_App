const User = require('../models/User');
const School = require('../models/School');
const { FIELD_STAFF, ADMIN_ROLES } = require('../utils/roles');

// "Staff" means people who work FOR IECE. That is every field role (trainers,
// (trainee) team leaders, zonal / cluster / regional heads) plus the Admin and
// CEO logins. `chairman` is deliberately excluded: those are the school-side
// logins, not IECE employees.
const STAFF_ROLES = [...FIELD_STAFF, ...ADMIN_ROLES];

/**
 * GET /api/stats/overview
 *
 * Organisation-wide headline numbers for the home screen.
 *
 * Open to EVERY authenticated user (no `authorize`) because the home dashboard
 * is shown to every role, chairman included — these are public-facing "about
 * IECE" figures, not scoped operational data.
 *
 * Uses `countDocuments` rather than fetching and counting in the client: the
 * existing `GET /api/schools` returns every school document with its chairman
 * populated, which is a lot of payload to throw away for one integer.
 */
exports.getOverview = async (req, res) => {
  try {
    const [staff, schools] = await Promise.all([
      User.countDocuments({ role: { $in: STAFF_ROLES } }),
      // Archived schools are excluded — the same rule every active school list
      // in the app follows.
      School.countDocuments({ isDeleted: { $ne: true } }),
    ]);

    res.status(200).json({ success: true, data: { staff, schools } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
