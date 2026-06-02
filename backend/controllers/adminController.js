const User = require('../models/User');
const School = require('../models/School');

// @desc    Get all Team Leaders
// @route   GET /api/admin/team-leaders
// @access  Private/CreatorAdmin
exports.getTeamLeaders = async (req, res) => {
  try {
    const teamLeaders = await User.find({ role: 'team_leader' }).select('-password');
    res.status(200).json({ success: true, data: teamLeaders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Get all Schools
// @route   GET /api/admin/schools
// @access  Private/CreatorAdmin
exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find();
    res.status(200).json({ success: true, data: schools });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Create a Team Leader
// @route   POST /api/admin/team-leader
// @access  Private/CreatorAdmin
exports.createTeamLeader = async (req, res) => {
  try {
    const { name, email, password, schoolId } = req.body;
    
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    user = await User.create({
      name,
      email,
      password,
      role: 'team_leader',
      schoolId
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create a Chairman and their School
// @route   POST /api/admin/chairman-school
// @access  Private/CreatorAdmin
exports.createChairmanAndSchool = async (req, res) => {
  try {
    const { 
      chairmanName, email, password, 
      schoolName, associationYear, classCoverage, state, mouPdfUrl
    } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    // 1. Create Chairman
    const chairman = await User.create({
      name: chairmanName,
      email,
      password,
      role: 'chairman'
    });

    // 2. Create School
    const school = await School.create({
      name: schoolName,
      chairmanId: chairman._id,
      associationYear,
      classCoverage,
      state,
      mouPdfUrl
    });

    // 3. Optional: Link School to Chairman if we keep schoolId on Chairman
    chairman.schoolId = school._id;
    await chairman.save();

    res.status(201).json({ success: true, data: { chairman, school } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create a Trainer
// @route   POST /api/admin/trainer
// @access  Private/CreatorAdmin
exports.createTrainer = async (req, res) => {
  try {
    const { name, email, password, schoolId, teamLeaderId } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    user = await User.create({
      name,
      email,
      password,
      role: 'trainer',
      schoolId,
      teamLeaderId
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get paginated users by role
// @route   GET /api/admin/users
// @access  Private/CreatorAdmin
exports.getUsersPaginated = async (req, res) => {
  try {
    const { role, page = 1, limit = 10, teamLeaderId } = req.query;
    if (!role) {
      return res.status(400).json({ success: false, error: 'Role is required' });
    }

    const query = { role };
    if (teamLeaderId) {
      query.teamLeaderId = teamLeaderId;
    }
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const users = await User.find(query)
      .select('-password')
      .populate('schoolId')
      .populate('teamLeaderId', 'name email')
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(); // to attach virtuals or modify data

    const total = await User.countDocuments(query);

    // If role is chairman, we might also want to fetch their school details separately if schoolId isn't on User
    // But in createChairmanAndSchool, we do: chairman.schoolId = school._id;
    // So it should be populated.

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Update a user
// @route   PUT /api/admin/user/:id
// @access  Private/CreatorAdmin
exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { name, email, password, schoolId, teamLeaderId, schoolName, associationYear, classCoverage } = req.body;

    user.name = name || user.name;
    user.email = email || user.email;
    if (password) {
      user.password = password; // will be hashed in pre-save hook
    }

    if (user.role === 'trainer') {
      if (schoolId) user.schoolId = schoolId;
      if (teamLeaderId) user.teamLeaderId = teamLeaderId;
    }

    await user.save();

    // If Chairman, update School details
    if (user.role === 'chairman' && user.schoolId) {
      const school = await School.findById(user.schoolId);
      if (school) {
        school.name = schoolName || school.name;
        school.associationYear = associationYear || school.associationYear;
        school.classCoverage = classCoverage || school.classCoverage;
        await school.save();
      }
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete a user
// @route   DELETE /api/admin/user/:id
// @access  Private/CreatorAdmin
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.role === 'team_leader') {
      // Unlink trainers assigned to this Team Leader instead of blocking
      await User.updateMany({ teamLeaderId: user._id }, { $set: { teamLeaderId: null } });
    }

    if (user.role === 'chairman') {
      const school = await School.findOne({ chairmanId: user._id });
      if (school) {
        // Unlink trainers and team leaders assigned to this School instead of blocking
        await User.updateMany({ schoolId: school._id }, { $set: { schoolId: null } });
        await School.findByIdAndDelete(school._id);
      }
    }

    await User.findByIdAndDelete(user._id);

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
