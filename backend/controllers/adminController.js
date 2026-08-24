const User = require('../models/User');
const School = require('../models/School');
const Team = require('../models/Team');
const Activity = require('../models/Activity');
const VisitReport = require('../models/VisitReport');
const Attendance = require('../models/Attendance');
const PendingAdminRequest = require('../models/PendingAdminRequest');
const { HEAD_ROLES, LEADER_ROLES, TEAM_MEMBER_ROLES } = require('../utils/roles');
const {
  isAnonymousParam,
  findAnonymousRegistration,
  findSchoolRegistration,
} = require('../utils/anonymousLocation');
const { notifyUser, notifyUserById } = require('../utils/pushNotification');
const { purgeFaceVideo, purgeFaceVideos, faceVideoNote } = require('../utils/faceVideo');
const { sendOtp, generateOtp } = require('../utils/email');
const { decisionOf, trail } = require('../utils/approvalTrail');
const { trackChanges } = require('../utils/changeSummary');
const { ROLE_LABELS } = require('../utils/roleLabels');

const roleLabel = (r) => ROLE_LABELS[r] || r;

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
      // Embeddings are hundreds of floats per school and are useless to the
      // client; the per-school registration metadata is what the admin UI needs.
      .select('-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
      .populate('schoolId', 'name state associationYear classCoverage')
      .populate('schoolIds', 'name state associationYear classCoverage')
      .populate('teamId', 'name')
      .populate('faceRegistrations.schoolId', 'name state')
      // Resolves "Approved by" for face registrations decided before the
      // decidedBy snapshot existed.
      .populate('faceRegistrations.reviewedBy', 'name role')
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

    trail({
      entityType: 'team',
      entityId: team._id,
      entityLabel: `Team · ${team.name}`,
      actor: req.user,
      action: 'created',
    });
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

// @desc    Get one Team with its people (members + overseeing heads)
// @route   GET /api/admin/team/:id
// @access  Private/CreatorAdmin + CEO + Heads (own teams only)
exports.getTeamById = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('createdBy', 'name role');
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    // A head may only drill into a team they actually oversee.
    if (HEAD_ROLES.includes(req.user.role)) {
      const mine = (req.user.teamIds || []).map(String);
      if (!mine.includes(String(team._id))) {
        return res.status(403).json({ success: false, error: 'Not authorized to view this team' });
      }
    }

    // Members carry a single teamId; heads oversee via the teamIds array.
    const MEMBER_FIELDS = '-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding';
    const [members, heads] = await Promise.all([
      User.find({ teamId: team._id, role: { $in: TEAM_MEMBER_ROLES } })
        .select(MEMBER_FIELDS)
        .populate('schoolId', 'name state')
        .populate('schoolIds', 'name state')
        .populate('teamLeaderId', 'name email role')
        .sort('name'),
      User.find({ teamIds: team._id, role: { $in: HEAD_ROLES } })
        .select('name email role')
        .sort('name'),
    ]);

    // Leaders first, then trainers — the same seniority order the drill-in shows.
    const leaders = members.filter(m => LEADER_ROLES.includes(m.role));
    const trainers = members.filter(m => m.role === 'trainer');

    // Distinct schools this team covers, across every member's assignments.
    const schoolMap = new Map();
    members.forEach((m) => {
      const list = (m.schoolIds && m.schoolIds.length) ? m.schoolIds : (m.schoolId ? [m.schoolId] : []);
      list.forEach((s) => {
        if (s && s._id) schoolMap.set(String(s._id), { _id: s._id, name: s.name, state: s.state });
      });
    });

    res.status(200).json({
      success: true,
      data: {
        team,
        members: [...leaders, ...trainers],
        heads,
        schools: [...schoolMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
        counts: {
          members: members.length,
          leaders: leaders.length,
          trainers: trainers.length,
          heads: heads.length,
          schools: schoolMap.size,
        },
      },
    });
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
    // Counted first: a deleted team leaves no way to ask afterwards how many
    // people it had, and "how many staff did that detach?" is the whole reason
    // anyone looks this row up.
    const [memberCount, headCount] = await Promise.all([
      User.countDocuments({ teamId: team._id }),
      User.countDocuments({ teamIds: team._id }),
    ]);
    await User.updateMany({ teamId: team._id }, { $set: { teamId: null } });
    await User.updateMany({ teamIds: team._id }, { $pull: { teamIds: team._id } });
    await Team.findByIdAndDelete(team._id);

    res.status(200).json({ success: true, data: {} });

    trail({
      entityType: 'team',
      entityId: team._id,
      entityLabel: `Team · ${team.name}`,
      actor: req.user,
      action: 'deleted',
      note: `Team deleted. ${memberCount} member(s) detached; removed from ${headCount} head(s) oversight.`,
    });
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

    if (!HEAD_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid head role' });
    }

    // An anonymous-location head belongs to no school by definition, so any
    // schools the form happened to send are dropped rather than half-applied.
    const anonymousLocation = Boolean(req.body.anonymousLocation);
    const schoolIds = anonymousLocation ? [] : normalizeSchoolIds(req.body);

    if (!anonymousLocation && schoolIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Assign at least one school, or mark this head as Anonymous Location.',
      });
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
      anonymousLocation,
      schoolIds,
      schoolId: schoolIds[0] || null,
      teamIds: Array.isArray(teamIds) ? teamIds : [],
      createdByAdmin: decisionOf(req.user, 'created')
    });

    res.status(201).json({ success: true, data: user });

    trail({
      entityType: 'user',
      entityId: user._id,
      entityLabel: `${user.name} · ${roleLabel(user.role)}`,
      subject: user,
      actor: req.user,
      action: 'created',
      note: anonymousLocation
        ? 'Head created on Anonymous Location (no school anchor).'
        : `Head created with ${schoolIds.length} school(s) and ${(user.teamIds || []).length} team(s).`,
      school: schoolIds[0] || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get all active Schools (archived ones are excluded)
// @route   GET /api/admin/schools
// @access  Private/CreatorAdmin
exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find({ isDeleted: { $ne: true } }).sort('-createdAt');
    res.status(200).json({ success: true, data: schools });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Get archived (soft-deleted) Schools, with the work they still hold
// @route   GET /api/admin/schools/archived
// @access  Private/CreatorAdmin + CEO
exports.getArchivedSchools = async (req, res) => {
  try {
    const schools = await School.find({ isDeleted: true })
      .populate('deletedBy', 'name role')
      .sort('-deletedAt');

    // Show the admin exactly what is being preserved, so it is obvious nothing
    // was destroyed along with the school login.
    const data = await Promise.all(schools.map(async (school) => {
      const [activities, visitReports, attendance] = await Promise.all([
        Activity.countDocuments({ schoolId: school._id }),
        VisitReport.countDocuments({ schoolId: school._id }),
        Attendance.countDocuments({ schoolId: school._id }),
      ]);
      return { ...school.toObject(), preserved: { activities, visitReports, attendance } };
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Restore an archived School
// @route   PUT /api/admin/school/:id/restore
// @access  Private/CreatorAdmin
exports.restoreSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    if (!school.isDeleted) {
      return res.status(400).json({ success: false, error: 'School is not archived' });
    }

    school.isDeleted = false;
    school.deletedAt = null;
    school.deletedBy = null;
    await school.save();

    // The chairman login was deleted with the school and cannot be recovered —
    // the admin has to create a fresh one. Staff assignments were detached too
    // and must be re-assigned; both stay visible in each person's history.
    const chairmanExists = await User.exists({ _id: school.chairmanId, role: 'chairman' });

    res.status(200).json({
      success: true,
      data: school,
      needsChairman: !chairmanExists,
    });

    trail({
      entityType: 'school',
      entityId: school._id,
      entityLabel: `School · ${school.name}`,
      actor: req.user,
      action: 'restored',
      note: chairmanExists
        ? 'School restored from the archive.'
        : 'School restored from the archive. It still needs a chairman login, and staff must be re-assigned.',
      school,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
      teamId: teamId || null,
      createdByAdmin: decisionOf(req.user, 'created')
    });

    res.status(201).json({ success: true, data: user });

    trail({
      entityType: 'user',
      entityId: user._id,
      entityLabel: `${user.name} · ${roleLabel(user.role)}`,
      subject: user,
      actor: req.user,
      action: 'created',
      note: `Created with ${schoolIds.length} school(s).`,
      school: schoolIds[0] || null,
    });
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
      role: 'chairman',
      createdByAdmin: decisionOf(req.user, 'created')
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

    // TWO rows, because two records were created and either can be looked up
    // on its own later. A single combined row would be findable only from
    // whichever of the two the reader happened to search for.
    trail({
      entityType: 'school',
      entityId: school._id,
      entityLabel: `School · ${school.name}`,
      actor: req.user,
      action: 'created',
      note: `School onboarded with chairman ${chairman.name}.`,
      school,
    });
    trail({
      entityType: 'user',
      entityId: chairman._id,
      entityLabel: `${chairman.name} · ${roleLabel('chairman')}`,
      subject: chairman,
      actor: req.user,
      action: 'created',
      note: `Chairman login created for ${school.name}.`,
      school,
    });
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
      teamId: teamId || null,
      createdByAdmin: decisionOf(req.user, 'created')
    });

    res.status(201).json({ success: true, data: user });

    trail({
      entityType: 'user',
      entityId: user._id,
      entityLabel: `${user.name} · ${roleLabel('trainer')}`,
      subject: user,
      actor: req.user,
      action: 'created',
      note: `Created with ${schoolIds.length} school(s).`,
      school: schoolIds[0] || null,
    });

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
      // Embeddings are hundreds of floats per school and are useless to the
      // client; the per-school registration metadata is what the admin UI needs.
      .select('-password -faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
      .populate('schoolId')
      .populate('schoolIds')
      .populate('teamLeaderId', 'name email')
      .populate('teamId', 'name')
      .populate('teamIds', 'name')
      .populate('faceRegistrations.schoolId', 'name state')
      // Resolves "Approved by" for face registrations decided before the
      // decidedBy snapshot existed. One extra batched query for the whole page;
      // the response filter drops it again for non-Admin/CEO callers.
      .populate('faceRegistrations.reviewedBy', 'name role')
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

// @desc    Every login in the app, four fields each, for people-pickers
// @route   GET /api/admin/directory
// @access  Private/Admin+CEO
//
// getUsersPaginated deliberately REQUIRES a role and returns fat documents
// (schools, teams, face registrations). A picker that has to offer "everybody
// irrespective of their login" would have to call it once per role and drag all
// of that down to render a name and a role chip. This returns the whole
// directory in one lean query instead, small enough to search on the device.
exports.getDirectory = async (req, res) => {
  try {
    const users = await User.find({})
      .select('name email role')
      .sort('name')
      .lean();

    res.status(200).json({ success: true, count: users.length, data: users });
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

    // Snapshot BEFORE anything is touched. Mongoose mutates the document in
    // place, so once the assignments below run there is no "before" left to
    // compare against and the log could only say "edited".
    const before = {
      name: user.name,
      email: user.email,
      role: user.role,
      anonymousLocation: !!user.anonymousLocation,
      schoolIds: (user.schoolIds || []).map(String),
      teamIds: (user.teamIds || []).map(String),
      teamId: user.teamId ? String(user.teamId) : null,
      teamLeaderId: user.teamLeaderId ? String(user.teamLeaderId) : null,
      faceRegistrations: (user.faceRegistrations || []).length,
    };

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

    // Registrations discarded by this edit. Every branch below that throws a
    // registration away puts it here instead of just dropping it, because the
    // entry is the ONLY thing that knows the URL of the video it uploaded —
    // once it is gone from the array, that recording is unreachable and sits in
    // the Cloudinary account for good. Purged in one sweep before the save.
    const discardedRegs = [];
    const discard = (regs) => { discardedRegs.push(...regs); };

    const applySchools = () => {
      if (!schoolsProvided) return;
      const newIds = normalizeSchoolIds(req.body);
      user.schoolIds = newIds;
      user.schoolId = newIds[0] || null;
      if (Array.isArray(user.faceRegistrations) && user.faceRegistrations.length) {
        const allowed = new Set(newIds);
        // A school-less (anonymous) registration is kept regardless: it is not
        // tied to any school, so no school assignment can invalidate it. It is
        // dropped explicitly below when anonymous mode itself is switched off.
        const keeps = (fr) => !fr.schoolId || allowed.has(String(fr.schoolId));
        discard(user.faceRegistrations.filter((fr) => !keeps(fr)));
        user.faceRegistrations = user.faceRegistrations.filter(keeps);
      }
    };

    // Anonymous location — heads only, and switchable at any time. Turning it
    // ON detaches every school (the stint stays in schoolHistory via the
    // pre-save hook); turning it OFF requires real schools to go back to, and
    // retires the school-less face registration, which now anchors nothing.
    const anonymousProvided = req.body.anonymousLocation !== undefined;
    const wantsAnonymous = Boolean(req.body.anonymousLocation);

    if (anonymousProvided && !HEAD_ROLES.includes(user.role) && wantsAnonymous) {
      return res.status(400).json({
        success: false,
        error: 'Only zonal, cluster and regional heads can be set to Anonymous Location.',
      });
    }

    // Assignment fields, applied by the effective (possibly new) role.
    if (user.role === 'trainer') {
      applySchools();
      if (teamLeaderId !== undefined) user.teamLeaderId = teamLeaderId || null;
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (LEADER_ROLES.includes(user.role)) {
      applySchools();
      if (teamId !== undefined) user.teamId = teamId || null;
    } else if (HEAD_ROLES.includes(user.role)) {
      const nowAnonymous = anonymousProvided ? wantsAnonymous : Boolean(user.anonymousLocation);

      if (nowAnonymous) {
        user.anonymousLocation = true;
        user.schoolIds = [];
        user.schoolId = null;

        const regs = user.faceRegistrations || [];
        // Switching an EXISTING head to anonymous has to take effect at once —
        // they should be able to check in from anywhere on their very next
        // shift. Dropping every per-school registration outright would instead
        // send them back to the registration queue, waiting on an approval the
        // Admin has in fact already given for that same face.
        //
        // So if they have no school-less registration yet, their most recently
        // approved school one is carried over: the school anchor is released
        // (anonymous mode measures nothing against it anyway) while the
        // identity decision behind it is kept. Only an APPROVED registration
        // qualifies — a pending or rejected one carries no such decision, and
        // is dropped with the rest.
        if (!regs.some((fr) => !fr.schoolId)) {
          const approved = regs
            .filter((fr) => fr.schoolId && fr.status === 'approved')
            .sort((a, b) => new Date(b.reviewedAt || b.updatedAt || 0) - new Date(a.reviewedAt || a.updatedAt || 0))[0];
          if (approved) approved.schoolId = null;
        }

        // Whatever is still tied to a school belongs to schools they no longer hold.
        discard(regs.filter((fr) => fr.schoolId));
        user.faceRegistrations = regs.filter((fr) => !fr.schoolId);
      } else {
        const newIds = schoolsProvided ? normalizeSchoolIds(req.body) : (user.schoolIds || []).map(String);
        if (newIds.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Assign at least one school, or keep this head on Anonymous Location.',
          });
        }
        user.anonymousLocation = false;
        applySchools();
        // The school-less registration means nothing once they are anchored again.
        discard((user.faceRegistrations || []).filter((fr) => !fr.schoolId));
        user.faceRegistrations = (user.faceRegistrations || []).filter((fr) => fr.schoolId);
      }

      if (Array.isArray(teamIds)) user.teamIds = teamIds;
    }

    // A head demoted to another role can never stay anonymous.
    if (!HEAD_ROLES.includes(user.role)) user.anonymousLocation = false;

    // Registrations may have been pruned above (schools taken away, anonymous
    // mode switched); the coarse aggregate has to follow, or someone keeps an
    // "approved" badge for a registration that no longer exists.
    syncLegacyFaceStatus(user);

    // The videos behind every registration this edit threw away. Run AFTER the
    // filtering (so the "is this legacy URL still referenced?" check sees the
    // survivors) and BEFORE the save, so the cleared URLs are persisted with
    // everything else. Best-effort: a storage hiccup must not fail an edit that
    // otherwise succeeded — it is reported in the log instead.
    let discardedCloud = null;
    if (discardedRegs.length) {
      try {
        discardedCloud = await purgeFaceVideos(user, discardedRegs);
      } catch (e) {
        console.error('Face video purge on user edit failed:', e.message);
      }
    }

    await user.save();

    // If Chairman, update School details
    let schoolChanges = null;
    let editedSchool = null;
    if (user.role === 'chairman' && user.schoolId) {
      const school = await School.findById(user.schoolId);
      if (school) {
        schoolChanges = trackChanges()
          .field('name', school.name, schoolName || school.name)
          .field('association year', school.associationYear, associationYear || school.associationYear)
          .field('class coverage', school.classCoverage, classCoverage || school.classCoverage);
        school.name = schoolName || school.name;
        school.associationYear = associationYear || school.associationYear;
        school.classCoverage = classCoverage || school.classCoverage;
        await school.save();
        editedSchool = school;
      }
    }

    res.status(200).json({ success: true, data: user });

    // What actually moved, in words. A row that only said "Admin edited Ravi
    // Kumar" left the interesting half — a role change? a school swap? a
    // password reset? — to memory, which is where it was being lost.
    const changes = trackChanges()
      .field('name', before.name, user.name)
      .field('email', before.email, user.email)
      .field('role', before.role, user.role, roleLabel)
      .field('anonymous location', before.anonymousLocation, !!user.anonymousLocation)
      .count('schools', before.schoolIds, (user.schoolIds || []).map(String))
      .count('teams overseen', before.teamIds, (user.teamIds || []).map(String))
      .field('team', before.teamId, user.teamId ? String(user.teamId) : null, (v) => (v ? 'assigned' : 'none'))
      .field('team leader', before.teamLeaderId, user.teamLeaderId ? String(user.teamLeaderId) : null, (v) => (v ? 'assigned' : 'none'));

    // The value is never written down — only the fact that it moved.
    if (password) changes.secret('password');

    const regsAfter = (user.faceRegistrations || []).length;
    if (regsAfter !== before.faceRegistrations) {
      changes.note(
        `face registrations: ${before.faceRegistrations} → ${regsAfter}`
        + (regsAfter < before.faceRegistrations ? ' (dropped with the schools they left)' : '')
      );
    }
    if (discardedCloud && discardedCloud.requested) {
      changes.note(faceVideoNote(discardedCloud).toLowerCase());
    }

    // A save that changed nothing is not worth a row — it would bury the edits
    // that did change something.
    if (changes.changed) {
      trail({
        entityType: 'user',
        entityId: user._id,
        entityLabel: `${user.name} · ${roleLabel(user.role)}`,
        subject: user,
        actor: req.user,
        action: 'updated',
        note: changes.summary(),
        school: user.schoolId || null,
      });
    }

    if (editedSchool && schoolChanges && schoolChanges.changed) {
      trail({
        entityType: 'school',
        entityId: editedSchool._id,
        entityLabel: `School · ${editedSchool.name}`,
        actor: req.user,
        action: 'updated',
        note: schoolChanges.summary(),
        school: editedSchool,
      });
    }
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

    // Everything the log will need is read here, while the document still
    // exists. A deletion is the one change whose subject cannot be inspected
    // afterwards, so anything not captured now is unanswerable forever.
    const archivedSchools = [];
    let detachedTrainers = 0;

    if (LEADER_ROLES.includes(user.role)) {
      // Unlink trainers assigned to this (Trainee) Team Leader instead of blocking
      detachedTrainers = await User.countDocuments({ teamLeaderId: user._id });
      await User.updateMany({ teamLeaderId: user._id }, { $set: { teamLeaderId: null } });
    }

    if (user.role === 'chairman') {
      const schools = await School.find({ chairmanId: user._id, isDeleted: { $ne: true } });
      for (const school of schools) {
        // Unlink everyone assigned to this School (multi-school aware) instead
        // of blocking: pull the school from schoolIds, drop its per-school face
        // registration, and re-sync the legacy primary school. The pre-save
        // hook closes each person's stint at the school so it stays in their
        // profile history.
        const affected = await User.find({ schoolIds: school._id });
        for (const member of affected) {
          member.schoolIds = (member.schoolIds || []).filter(
            (id) => String(id) !== String(school._id)
          );
          member.schoolId = member.schoolIds[0] || null;
          // These belong to somebody ELSE, and archiving the school throws
          // them away. Their videos go with them for the same reason as
          // everywhere else: the entry is the only record of the URL, so this
          // is the last moment the file can be found at all.
          const losing = (member.faceRegistrations || []).filter(
            (fr) => String(fr.schoolId) === String(school._id)
          );
          member.faceRegistrations = (member.faceRegistrations || []).filter(
            (fr) => String(fr.schoolId) !== String(school._id)
          );
          if (losing.length) {
            try {
              await purgeFaceVideos(member, losing);
            } catch (e) {
              console.error('Face video purge on school archive failed:', e.message);
            }
          }
          member.$locals.schoolRemovalReason = 'school_deleted';
          await member.save();
        }
        // Safety net for any legacy user that only had the single schoolId set.
        await User.updateMany({ schoolId: school._id }, { $set: { schoolId: null } });

        // ARCHIVE, never delete. Activities, visit reports, attendance and
        // holidays all reference this school — removing the document would
        // orphan every one of them. Archiving hides the school from all
        // active lists while their history keeps resolving its name.
        school.isDeleted = true;
        school.deletedAt = new Date();
        school.deletedBy = req.user._id || req.user.id;
        school.archivedChairman = { name: user.name, email: user.email };
        await school.save();
        archivedSchools.push({ school, detached: affected.length });
      }
    }

    // Capture the push token before deletion so we can force-logout the user's
    // device. (After delete, protect() already 401s their token on the next
    // request and the app logs them out — this just makes it instant.)
    const deletedUserForPush = { expoPushToken: user.expoPushToken };

    // Their face recordings go with them. Once the document is deleted nothing
    // anywhere remembers these URLs, so this is the last moment it is possible.
    const cloud = await purgeFaceVideos(user);

    // Snapshot for the log — after findByIdAndDelete there is no document left
    // to read a name or a role off.
    const deleted = {
      _id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
      schoolId: user.schoolId || null,
    };
    const deletedAt = new Date();

    await User.findByIdAndDelete(user._id);

    res.status(200).json({
      success: true,
      data: {},
      cloud: { requested: cloud.requested, deleted: cloud.deleted, failed: cloud.failed },
    });

    const consequences = [];
    if (detachedTrainers) consequences.push(`${detachedTrainers} trainer(s) detached`);
    if (archivedSchools.length) {
      consequences.push(`${archivedSchools.length} school(s) archived`);
    }
    if (cloud.requested) {
      consequences.push(
        cloud.ok
          ? `${cloud.requested} face registration video(s) deleted from cloud storage`
          : `${cloud.failed} of ${cloud.requested} face registration video(s) could NOT be deleted from cloud storage`
      );
    }

    trail({
      entityType: 'user',
      entityId: deleted._id,
      entityLabel: `${deleted.name} · ${roleLabel(deleted.role)}`,
      subject: deleted,
      actor: req.user,
      action: 'deleted',
      note: `Account deleted (${deleted.email}).`
        + (consequences.length ? ` ${consequences.join('; ')}.` : ''),
      school: deleted.schoolId,
      at: deletedAt,
    });

    // A school archived as a side effect of removing its chairman is a change to
    // the SCHOOL, and someone looking the school up later has no reason to
    // think of searching for a person's deletion to find out what happened.
    archivedSchools.forEach(({ school, detached }) => {
      trail({
        entityType: 'school',
        entityId: school._id,
        entityLabel: `School · ${school.name}`,
        actor: req.user,
        action: 'archived',
        note: `Archived when the chairman login (${deleted.name}) was deleted. `
          + `${detached} staff assignment(s) detached. Activities, visit reports and attendance were kept.`,
        school,
        at: deletedAt,
      });
    });

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

    // An anonymous-location head's registration has no school, so it is
    // addressed by the literal 'anonymous' instead of an id.
    const anonymous = isAnonymousParam(schoolId);
    const reg = anonymous
      ? findAnonymousRegistration(user)
      : findSchoolRegistration(user, schoolId);
    if (!reg) {
      return res.status(404).json({ success: false, error: 'No facial registration found for this school' });
    }

    // This endpoint predates the approvals hub and used to record nothing at
    // all, so face registrations approved from the legacy admin screen were
    // anonymous. It now records the approver exactly as /api/approvals does.
    const decidedAt = new Date();
    reg.status = 'approved';
    reg.reviewedBy = req.user._id;
    reg.reviewedAt = decidedAt;
    reg.decidedBy = decisionOf(req.user, 'approved', decidedAt);
    syncLegacyFaceStatus(user);

    // The embedding is stored, so the video has done its job — delete it, the
    // same as the /api/approvals route does. This is a second door onto one
    // decision and the two must not leave the cloud in different states.
    const cloud = await purgeFaceVideo(user, reg);

    await user.save();

    let schoolName = 'the school';
    let school = null;
    if (!anonymous) {
      school = await School.findById(schoolId).select('name');
      if (school) schoolName = school.name;
    }

    res.status(200).json({ success: true, data: user });

    trail({
      entityType: 'face_registration',
      entityId: reg._id,
      entityLabel: anonymous
        ? 'Facial registration · any location'
        : `Facial registration · ${schoolName}`,
      subject: user,
      actor: req.user,
      action: 'approved',
      // Literally the same sentence the /api/approvals route writes — it comes
      // from the same function — so one decision reads the same in the log
      // whichever screen took it.
      note: faceVideoNote(cloud),
      school,
      at: decidedAt,
    });

    // Notify the person that they can now mark attendance at this school.
    notifyUser(
      user,
      '✅ Facial Registration Approved',
      anonymous
        ? 'Your facial registration has been approved. You can now check in and out from any location.'
        : `Your facial registration for ${schoolName} has been approved. You can now mark attendance there.`,
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

    // 'anonymous' addresses the school-less registration of an anonymous-
    // location head; anything else is a real school id.
    const anonymous = isAnonymousParam(schoolId);
    const before = (user.faceRegistrations || []).length;
    const isDoomed = (fr) =>
      anonymous ? !fr.schoolId : !!(fr.schoolId && String(fr.schoolId) === String(schoolId));
    // Captured before the filter — once these entries are dropped, the URL of
    // the video each one uploaded is gone with them and the file could never be
    // found again.
    const doomed = (user.faceRegistrations || []).filter(isDoomed);
    user.faceRegistrations = (user.faceRegistrations || []).filter((fr) => !isDoomed(fr));
    if (user.faceRegistrations.length === before) {
      return res.status(404).json({ success: false, error: 'No facial registration found for this school' });
    }

    // Throwing the registration away throws its video away too.
    const cloud = await purgeFaceVideos(user, doomed);

    // Clear the legacy fields only once no per-school registrations remain.
    if (user.faceRegistrations.length === 0) {
      user.faceEmbedding = [];
      user.faceEmbeddingV2 = [];
      user.registrationLocation = null;
      user.registrationPhotoUrl = null;
    }
    syncLegacyFaceStatus(user);
    await user.save();

    let schoolName = 'a school';
    if (!anonymous) {
      const school = await School.findById(schoolId).select('name');
      if (school) schoolName = school.name;
    }

    // Compact payload — the admin screen only needs to know what is left, and
    // the full user document would ship every remaining face embedding.
    res.status(200).json({
      success: true,
      data: {
        userId: user._id,
        schoolId,
        schoolName,
        remaining: user.faceRegistrations.length,
        facialRegistrationStatus: user.facialRegistrationStatus
      }
    });

    // Wiping somebody's face registration is a deletion the Admin performs on
    // another person's record, and until now it left no trace anywhere. It ends
    // their ability to mark attendance until they re-register, so it belongs in
    // the log beside the approval that first let them in.
    trail({
      entityType: 'face_registration',
      entityId: user._id,
      entityLabel: anonymous
        ? 'Facial registration · any location'
        : `Facial registration · ${schoolName}`,
      subject: user,
      actor: req.user,
      action: 'deleted',
      note: cloud.requested === 0
        ? 'Registration removed. There was no video in cloud storage.'
        : `Registration removed. ${faceVideoNote(cloud)}.`,
      school: anonymous ? null : schoolId,
    });

    // Let the user know they need to register their face again for this school.
    notifyUser(
      user,
      'Facial Registration Removed',
      anonymous
        ? 'Your facial registration was removed. Please register your face again to mark attendance.'
        : `Your facial registration for ${schoolName} was removed. Please register your face again there to mark attendance.`,
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
      createdByAdmin: decisionOf(req.user, 'created'),
    });

    trail({
      entityType: 'admin_account',
      entityId: newAdmin._id,
      entityLabel: `Admin login · ${newAdmin.name} (${newAdmin.email})`,
      subject: newAdmin,
      actor: req.user,
      action: 'created',
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

