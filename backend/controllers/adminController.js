const User = require('../models/User');
const School = require('../models/School');
const Team = require('../models/Team');
const PendingAdminRequest = require('../models/PendingAdminRequest');
const { HEAD_ROLES, LEADER_ROLES, TEAM_MEMBER_ROLES } = require('../utils/roles');
const { notifyUser, notifyUserById } = require('../utils/pushNotification');
const { sendOtp, generateOtp } = require('../utils/email');

const EMAIL_RE = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Mask an email for display: joh****@example.com
const maskEmail = (e) => {
  const [local, domain] = String(e || '').split('@');
  if (!domain) return e;
  const shown = local.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(2, local.length - shown.length))}@${domain}`;
};

// Normalize the schools sent from the client into a de-duplicated array.
// Accepts the new `schoolIds` array or falls back to a single legacy `schoolId`.
function normalizeSchoolIds(body) {
  const list = Array.isArray(body.schoolIds)
    ? body.schoolIds
    : (body.schoolId ? [body.schoolId] : []);
  return [...new Set(list.filter(Boolean).map(String))];
}

// @desc    Get all Team Leaders (and Trainee Team Leaders — full parity)
// @route   GET /api/admin/team-leaders
// @access  Private/CreatorAdmin
exports.getTeamLeaders = async (req, res) => {
  try {
    const teamLeaders = await User.find({ role: { $in: LEADER_ROLES } })
      .select('-password')
      .populate('schoolId', 'name state associationYear classCoverage')
      .populate('schoolIds', 'name state associationYear classCoverage')
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
    const { name, email, password, role, teamIds } = req.body;
    const schoolIds = normalizeSchoolIds(req.body);

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
      schoolIds,
      schoolId: schoolIds[0] || null,
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
    const { name, email, password, teamId } = req.body;
    const schoolIds = normalizeSchoolIds(req.body);
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
      schoolIds,
      schoolId: schoolIds[0] || null,
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
    const { name, email, password, teamLeaderId, teamId } = req.body;
    const schoolIds = normalizeSchoolIds(req.body);

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    user = await User.create({
      name,
      email,
      password,
      role: 'trainer',
      schoolIds,
      schoolId: schoolIds[0] || null,
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
      .populate('schoolIds')
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
      teamLeaderId, teamId, teamIds,
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

    // Re-assign schools (multi-school aware) whenever the client sends either
    // the new schoolIds array or a legacy schoolId. Pruning face registrations
    // for any school the person is no longer assigned to prevents them keeping
    // check-in access to a school that was taken away.
    const schoolsProvided =
      req.body.schoolIds !== undefined || req.body.schoolId !== undefined;
    const applySchools = () => {
      if (!schoolsProvided) return;
      const newIds = normalizeSchoolIds(req.body);
      user.schoolIds = newIds;
      user.schoolId = newIds[0] || null;
      if (Array.isArray(user.faceRegistrations) && user.faceRegistrations.length) {
        const allowed = new Set(newIds);
        user.faceRegistrations = user.faceRegistrations.filter(
          (fr) => allowed.has(String(fr.schoolId))
        );
      }
    };

    // Assignment fields, applied by the effective (possibly new) role.
    if (user.role === 'trainer') {
      applySchools();
      if (teamLeaderId !== undefined) user.teamLeaderId = teamLeaderId || null;
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (LEADER_ROLES.includes(user.role)) {
      applySchools();
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (HEAD_ROLES.includes(user.role)) {
      applySchools();
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
        // Unlink everyone assigned to this School (multi-school aware) instead
        // of blocking: pull the school from schoolIds, drop its per-school face
        // registration, and re-sync the legacy primary school.
        const affected = await User.find({ schoolIds: school._id });
        for (const member of affected) {
          member.schoolIds = (member.schoolIds || []).filter(
            (id) => String(id) !== String(school._id)
          );
          member.schoolId = member.schoolIds[0] || null;
          member.faceRegistrations = (member.faceRegistrations || []).filter(
            (fr) => String(fr.schoolId) !== String(school._id)
          );
          await member.save();
        }
        // Safety net for any legacy user that only had the single schoolId set.
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
    // Return every user that has at least one per-school registration awaiting
    // approval. The admin approves each (user, school) pair independently.
    const users = await User.find({ 'faceRegistrations.status': 'pending' })
      .select('-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
      .populate('schoolIds', 'name state')
      .populate('faceRegistrations.schoolId', 'name state');

    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Recompute the coarse legacy aggregate status from the per-school registrations
// so older reads (and the frontend faceStatus gate) stay meaningful.
function syncLegacyFaceStatus(user) {
  const regs = user.faceRegistrations || [];
  if (regs.some(r => r.status === 'approved')) {
    user.facialRegistrationStatus = 'approved';
    user.facialRegistrationStatusV2 = 'approved';
  } else if (regs.some(r => r.status === 'pending')) {
    user.facialRegistrationStatus = 'pending';
    user.facialRegistrationStatusV2 = 'pending';
  } else {
    user.facialRegistrationStatus = 'none';
    user.facialRegistrationStatusV2 = 'none';
  }
}

// @desc    Approve a per-school facial registration
// @route   PUT /api/admin/approve-face-registration/:id/:schoolId
// @access  Private/CreatorAdmin
exports.approveFacialRegistration = async (req, res) => {
  try {
    const { id, schoolId } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const reg = (user.faceRegistrations || []).find(
      (fr) => String(fr.schoolId) === String(schoolId)
    );
    if (!reg) {
      return res.status(404).json({ success: false, error: 'No facial registration found for this school' });
    }

    reg.status = 'approved';
    syncLegacyFaceStatus(user);
    await user.save();

    const school = await School.findById(schoolId).select('name');
    const schoolName = school ? school.name : 'the school';

    res.status(200).json({ success: true, data: user });

    // Notify the person that they can now mark attendance at this school.
    notifyUser(
      user,
      '✅ Facial Registration Approved',
      `Your facial registration for ${schoolName} has been approved. You can now mark attendance there.`,
      { type: 'face_approved' }
    ).catch(err => console.error('Face-approved notification error:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete a per-school facial registration
// @route   DELETE /api/admin/face-registration/:id/:schoolId
// @access  Private/CreatorAdmin
exports.deleteFacialRegistration = async (req, res) => {
  try {
    const { id, schoolId } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const before = (user.faceRegistrations || []).length;
    user.faceRegistrations = (user.faceRegistrations || []).filter(
      (fr) => String(fr.schoolId) !== String(schoolId)
    );
    if (user.faceRegistrations.length === before) {
      return res.status(404).json({ success: false, error: 'No facial registration found for this school' });
    }

    // Clear the legacy fields only once no per-school registrations remain.
    if (user.faceRegistrations.length === 0) {
      user.faceEmbedding = [];
      user.faceEmbeddingV2 = [];
      user.registrationLocation = null;
      user.registrationPhotoUrl = null;
    }
    syncLegacyFaceStatus(user);
    await user.save();

    const school = await School.findById(schoolId).select('name');
    const schoolName = school ? school.name : 'a school';

    res.status(200).json({ success: true, data: user });

    // Let the user know they need to register their face again for this school.
    notifyUser(
      user,
      'Facial Registration Removed',
      `Your facial registration for ${schoolName} was removed. Please register your face again there to mark attendance.`,
      { type: 'face_removed' }
    ).catch(err => console.error('Face-removed notification error:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================================================
//  Create Admin — dual-OTP verified (existing admin's email + new admin's email)
// ===========================================================================

// @desc    Step 1 — validate the new admin's details and send both OTPs
// @route   POST /api/admin/create-admin/initiate
// @access  Private/CreatorAdmin
exports.initiateAdminCreation = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required' });
    }
    if (!email || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const newEmail = email.trim().toLowerCase();
    const requesterEmail = (req.user.email || '').trim();

    if (!requesterEmail) {
      return res.status(400).json({ success: false, error: 'Your account has no email on file to receive an OTP' });
    }
    if (newEmail === requesterEmail.toLowerCase()) {
      return res.status(400).json({ success: false, error: "The new admin's email must be different from yours" });
    }

    const exists = await User.findOne({ email: newEmail });
    if (exists) {
      return res.status(400).json({ success: false, error: 'A user with this email already exists' });
    }

    // Only one in-flight request per admin at a time.
    await PendingAdminRequest.deleteMany({ requestedBy: req.user._id });

    const requesterOtp = generateOtp();
    const newAdminOtp = generateOtp();

    const pending = await PendingAdminRequest.create({
      requestedBy: req.user._id,
      requesterEmail,
      name: name.trim(),
      email: newEmail,
      password,
      requesterOtp,
      newAdminOtp,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const [sentRequester, sentNew] = await Promise.all([
      sendOtp(requesterEmail, requesterOtp),
      sendOtp(newEmail, newAdminOtp),
    ]);

    if (!sentRequester || !sentNew) {
      await pending.deleteOne();
      return res.status(500).json({ success: false, error: 'Could not send the verification emails. Please try again.' });
    }

    res.status(200).json({
      success: true,
      requestId: pending._id,
      requesterEmailMasked: maskEmail(requesterEmail),
      newAdminEmailMasked: maskEmail(newEmail),
      expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Step 2 — verify BOTH OTPs, then create the admin
// @route   POST /api/admin/create-admin/verify
// @access  Private/CreatorAdmin
exports.verifyAndCreateAdmin = async (req, res) => {
  try {
    const { requestId, requesterOtp, newAdminOtp } = req.body;

    if (!requestId || !requesterOtp || !newAdminOtp) {
      return res.status(400).json({ success: false, error: 'The request id and both OTPs are required' });
    }

    const pending = await PendingAdminRequest.findById(requestId);
    if (!pending) {
      return res.status(400).json({ success: false, error: 'Verification session not found or expired. Please start again.' });
    }
    if (String(pending.requestedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You are not authorized for this request' });
    }
    if (pending.expiresAt < new Date()) {
      await pending.deleteOne();
      return res.status(400).json({ success: false, error: 'The verification codes have expired. Please start again.' });
    }
    if (pending.attempts >= 5) {
      await pending.deleteOne();
      return res.status(429).json({ success: false, error: 'Too many incorrect attempts. Please start again.' });
    }

    const okRequester = String(requesterOtp).trim() === pending.requesterOtp;
    const okNew = String(newAdminOtp).trim() === pending.newAdminOtp;

    if (!okRequester || !okNew) {
      pending.attempts += 1;
      await pending.save();
      const left = Math.max(0, 5 - pending.attempts);
      const which = !okRequester && !okNew
        ? 'Both OTPs are incorrect'
        : !okRequester ? 'Your OTP is incorrect' : "The new admin's OTP is incorrect";
      return res.status(400).json({ success: false, error: `${which}. ${left} attempt${left === 1 ? '' : 's'} left.` });
    }

    // Re-check the email is still free before creating.
    const exists = await User.findOne({ email: pending.email });
    if (exists) {
      await pending.deleteOne();
      return res.status(400).json({ success: false, error: 'A user with this email already exists' });
    }

    const newAdmin = await User.create({
      name: pending.name,
      email: pending.email,
      password: pending.password, // hashed by the User pre-save hook
      role: 'creator_admin',
    });

    await pending.deleteOne();

    const safe = newAdmin.toObject();
    delete safe.password;
    res.status(201).json({ success: true, data: safe });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Resend both OTPs for an in-flight admin-creation request
// @route   POST /api/admin/create-admin/resend
// @access  Private/CreatorAdmin
exports.resendAdminOtps = async (req, res) => {
  try {
    const { requestId } = req.body;
    const pending = await PendingAdminRequest.findById(requestId);
    if (!pending || String(pending.requestedBy) !== String(req.user._id)) {
      return res.status(404).json({ success: false, error: 'Verification session not found. Please start again.' });
    }

    pending.requesterOtp = generateOtp();
    pending.newAdminOtp = generateOtp();
    pending.attempts = 0;
    pending.expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await pending.save();

    const [s1, s2] = await Promise.all([
      sendOtp(pending.requesterEmail, pending.requesterOtp),
      sendOtp(pending.email, pending.newAdminOtp),
    ]);
    if (!s1 || !s2) {
      return res.status(500).json({ success: false, error: 'Could not resend the verification emails.' });
    }

    res.status(200).json({ success: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

