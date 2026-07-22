const User = require('../models/User');
const School = require('../models/School');
const Team = require('../models/Team');
const { HEAD_ROLES, LEADER_ROLES, TEAM_MEMBER_ROLES } = require('../utils/roles');
const { notifyUser, notifyUserById } = require('../utils/pushNotification');

// @desc    Get all Team Leaders (and Trainee Team Leaders — full parity)
// @route   GET /api/admin/team-leaders
// @access  Private/CreatorAdmin
exports.getTeamLeaders = async (req, res) => {
  try {
    const teamLeaders = await User.find({ role: { $in: LEADER_ROLES } })
      .select('-password')
      .populate('schoolId', 'name state associationYear classCoverage')
      .populate('teamId', 'name')
      .sort('-createdAt');
    res.status(200).json({ success: true, data: teamLeaders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Create a Team (single mandatory field: name)
// @route   POST /api/admin/team
// @access  Private/CreatorAdmin
exports.createTeam = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Team name is required' });
    }

    const existing = await Team.findOne({ name });
    if (existing) {
      return res.status(400).json({ success: false, error: 'A team with this name already exists' });
    }

    const team = await Team.create({ name, createdBy: req.user.id });
    res.status(201).json({ success: true, data: team });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get all Teams (with member + head counts for context)
// @route   GET /api/admin/teams
// @access  Private/CreatorAdmin + Heads
exports.getTeams = async (req, res) => {
  try {
    // A head only sees the teams assigned to them; admin sees all.
    let teams;
    if (HEAD_ROLES.includes(req.user.role)) {
      teams = await Team.find({ _id: { $in: req.user.teamIds || [] } }).sort('name');
    } else {
      teams = await Team.find().sort('name');
    }

    // Attach a lightweight member count so the UI can show "N members".
    const data = await Promise.all(teams.map(async (team) => {
      const memberCount = await User.countDocuments({ teamId: team._id });
      return { ...team.toObject(), memberCount };
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete a Team (unlink members and pull it from every head)
// @route   DELETE /api/admin/team/:id
// @access  Private/CreatorAdmin
exports.deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    // Detach members and remove the team from any head's oversight list.
    await User.updateMany({ teamId: team._id }, { $set: { teamId: null } });
    await User.updateMany({ teamIds: team._id }, { $pull: { teamIds: team._id } });
    await Team.findByIdAndDelete(team._id);

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create a Head (zonal / cluster / regional)
// @route   POST /api/admin/head
// @access  Private/CreatorAdmin
exports.createHead = async (req, res) => {
  try {
    const { name, email, password, role, schoolId, teamIds } = req.body;

    if (!HEAD_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid head role' });
    }

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    user = await User.create({
      name,
      email,
      password,
      role,
      schoolId: schoolId || null,
      teamIds: Array.isArray(teamIds) ? teamIds : []
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get all Schools
// @route   GET /api/admin/schools
// @access  Private/CreatorAdmin
exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find().sort('-createdAt');
    res.status(200).json({ success: true, data: schools });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Create a Team Leader or Trainee Team Leader (full parity)
// @route   POST /api/admin/team-leader
// @access  Private/CreatorAdmin
exports.createTeamLeader = async (req, res) => {
  try {
    const { name, email, password, schoolId, teamId } = req.body;
    // Defaults to team_leader; accepts trainee_team_leader for the same form.
    const role = LEADER_ROLES.includes(req.body.role) ? req.body.role : 'team_leader';

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    user = await User.create({
      name,
      email,
      password,
      role,
      schoolId,
      teamId: teamId || null
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
    const { name, email, password, schoolId, teamLeaderId, teamId } = req.body;

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
      teamLeaderId,
      teamId: teamId || null
    });

    res.status(201).json({ success: true, data: user });

    // Notify the assigned team leader that a new trainer joined their team.
    if (teamLeaderId) {
      notifyUserById(
        teamLeaderId,
        '👥 New Trainer Assigned',
        `${name} has been added to your team.`,
        { type: 'general' }
      ).catch(err => console.error('Trainer-assigned notification error:', err.message));
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get paginated users by role
// @route   GET /api/admin/users
// @access  Private/CreatorAdmin
exports.getUsersPaginated = async (req, res) => {
  try {
    const { role, page = 1, limit = 10, teamLeaderId, teamId } = req.query;
    if (!role) {
      return res.status(400).json({ success: false, error: 'Role is required' });
    }

    // `role` may be a single value or a comma-separated list (e.g. team_leader,trainee_team_leader).
    const roles = String(role).split(',').map(r => r.trim()).filter(Boolean);
    const query = roles.length > 1 ? { role: { $in: roles } } : { role: roles[0] };

    if (teamLeaderId) {
      query.teamLeaderId = teamLeaderId;
    }
    if (teamId) {
      query.teamId = teamId;
    }
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const users = await User.find(query)
      .select('-password')
      .populate('schoolId')
      .populate('teamLeaderId', 'name email')
      .populate('teamId', 'name')
      .populate('teamIds', 'name')
      .sort('-createdAt')
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

    const {
      name, email, password, role,
      schoolId, teamLeaderId, teamId, teamIds,
      schoolName, associationYear, classCoverage
    } = req.body;

    user.name = name || user.name;
    user.email = email || user.email;
    if (password) {
      user.password = password; // will be hashed in pre-save hook
    }

    // Admin has master privilege — allow re-assigning the role itself.
    if (role && User.schema.path('role').enumValues.includes(role)) {
      user.role = role;
    }

    // Assignment fields, applied by the effective (possibly new) role.
    if (user.role === 'trainer') {
      if (schoolId !== undefined) user.schoolId = schoolId || null;
      if (teamLeaderId !== undefined) user.teamLeaderId = teamLeaderId || null;
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (LEADER_ROLES.includes(user.role)) {
      if (schoolId !== undefined) user.schoolId = schoolId || null;
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (HEAD_ROLES.includes(user.role)) {
      if (schoolId !== undefined) user.schoolId = schoolId || null;
      if (Array.isArray(teamIds)) user.teamIds = teamIds;
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

    if (LEADER_ROLES.includes(user.role)) {
      // Unlink trainers assigned to this (Trainee) Team Leader instead of blocking
      await User.updateMany({ teamLeaderId: user._id }, { $set: { teamLeaderId: null } });
    }

    if (user.role === 'chairman') {
      const schools = await School.find({ chairmanId: user._id });
      for (const school of schools) {
        // Unlink trainers and team leaders assigned to this School instead of blocking
        await User.updateMany({ schoolId: school._id }, { $set: { schoolId: null } });
        await School.findByIdAndDelete(school._id);
      }
    }

    // Capture the push token before deletion so we can force-logout the user's
    // device. (After delete, protect() already 401s their token on the next
    // request and the app logs them out — this just makes it instant.)
    const deletedUserForPush = { expoPushToken: user.expoPushToken };

    await User.findByIdAndDelete(user._id);

    res.status(200).json({ success: true, data: {} });

    // Instantly sign out the deleted user's device if it's foregrounded.
    notifyUser(
      deletedUserForPush,
      'Signed out',
      'Your account has been removed.',
      { type: 'force_logout' }
    ).catch(err => console.error('Force-logout (account deleted) push error:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get pending facial registrations
// @route   GET /api/admin/pending-face-registrations
// @access  Private/CreatorAdmin
exports.getPendingFacialRegistrations = async (req, res) => {
  try {
    const users = await User.find({ 
      $or: [
        { facialRegistrationStatus: 'pending' },
        { facialRegistrationStatusV2: 'pending' }
      ]
    })
      .select('-password -faceEmbedding')
      .populate('schoolId', 'name state location');
      
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Approve facial registration
// @route   PUT /api/admin/approve-face-registration/:id
// @access  Private/CreatorAdmin
exports.approveFacialRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.facialRegistrationStatus = 'approved';
    user.facialRegistrationStatusV2 = 'approved';
    await user.save();

    res.status(200).json({ success: true, data: user });

    // Notify the trainer/team-leader that they can now mark attendance.
    notifyUser(
      user,
      '✅ Facial Registration Approved',
      'Your facial registration has been approved. You can now mark your attendance.',
      { type: 'face_approved' }
    ).catch(err => console.error('Face-approved notification error:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete facial registration
// @route   DELETE /api/admin/face-registration/:id
// @access  Private/CreatorAdmin
exports.deleteFacialRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.facialRegistrationStatus = 'none';
    user.facialRegistrationStatusV2 = 'none';
    user.faceEmbedding = [];
    user.faceEmbeddingV2 = [];
    user.registrationLocation = null;
    user.registrationPhotoUrl = null;
    await user.save();

    res.status(200).json({ success: true, data: user });

    // Let the user know they need to register their face again.
    notifyUser(
      user,
      'Facial Registration Removed',
      'Your facial registration was removed. Please register your face again to mark attendance.',
      { type: 'face_removed' }
    ).catch(err => console.error('Face-removed notification error:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

