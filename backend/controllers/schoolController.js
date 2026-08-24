const School = require('../models/School');
const { purgeAssets, purgeSummary } = require('../utils/cloudinary');
const { trail } = require('../utils/approvalTrail');
const User = require('../models/User');

exports.getSchools = async (req, res) => {
  try {
    const { state, chairmanId, includeArchived } = req.query;
    // Archived schools are kept only so past activities/reports/attendance keep
    // resolving their name — they never show up in an active school list.
    let query = includeArchived === 'true' ? {} : { isDeleted: { $ne: true } };
    if (state) query.state = state;
    if (chairmanId) query.chairmanId = chairmanId;
    const schools = await School.find(query).populate('chairmanId', 'name email');
    res.status(200).json({ success: true, count: schools.length, data: schools });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id).populate('chairmanId', 'name email');
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    res.status(200).json({ success: true, data: school });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createSchool = async (req, res) => {
  try {
    const school = await School.create(req.body);
    res.status(201).json({ success: true, data: school });

    trail({
      entityType: 'school',
      entityId: school._id,
      entityLabel: `School · ${school.name}`,
      actor: req.user,
      action: 'created',
      school,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getFacultyRoster = async (req, res) => {
  try {
    const faculty = await User.find({ 
      schoolId: req.params.id, 
      role: 'trainer' 
    }).select('-password');
    
    res.status(200).json({ success: true, count: faculty.length, data: faculty });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.uploadMou = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    const previousMou = school.mouPdfUrl;
    school.mouPdfUrl = req.body.mouPdfUrl || school.mouPdfUrl;
    await school.save();

    // Replacing the MOU orphans the document it replaced: this field was the
    // only thing that knew the old file's URL, and it has just been overwritten.
    // Best-effort — a storage hiccup must not fail an upload that succeeded.
    let purge = null;
    if (previousMou && previousMou !== school.mouPdfUrl) {
      purge = await purgeAssets([previousMou]);
    }

    res.status(200).json({
      success: true,
      data: school,
      ...(purge ? { cloud: { deleted: purge.deleted, missing: purge.missing, failed: purge.failed } } : {}),
    });

    // Replacing an MOU both adds a document and destroys the one it replaced.
    // Neither half is visible anywhere else once it has happened.
    trail({
      entityType: 'school',
      entityId: school._id,
      entityLabel: `School · ${school.name}`,
      actor: req.user,
      action: 'updated',
      note: previousMou
        ? `MOU replaced. ${purge ? purgeSummary(purge) : 'The previous file was left in place.'}`
        : 'MOU uploaded.',
      school,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
