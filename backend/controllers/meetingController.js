const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { getAdminRecipientIds } = require('../utils/hierarchy');
const { detectPlatform, normalizeUrl, isValidMeetingLink } = require('../utils/meetingPlatform');
const {
  FIELD_STAFF, ADMIN_ROLES, LEADER_ROLES, HEAD_ROLES,
} = require('../utils/roles');
const { ROLE_LABELS } = require('../utils/roleLabels');

const roleLabel = (role) => ROLE_LABELS[role] || role;
const isAdminRole = (role) => ADMIN_ROLES.includes(role);
const PLATFORM_LABEL = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  webex: 'Webex',
  other: 'Meeting',
};

// Show juniors first, seniors last, when ordering the "rest" of the candidates.
const ROLE_RANK = {
  trainer: 1,
  trainee_team_leader: 2,
  team_leader: 3,
  zonal_head: 4,
  cluster_head: 4,
  regional_head: 4,
  ceo: 5,
  creator_admin: 6,
};

const populateMeeting = (query) =>
  query
    .populate('createdBy', 'name role')
    .populate('recipients', 'name role');

// ---------------------------------------------------------------------------
// Recipient picker
// ---------------------------------------------------------------------------

// @desc    Candidate recipients for the caller, ORDERED by priority + flagged
//          with isMyTeam so the client can offer "All" / "My Team" quick-selects.
// @route   GET /api/meetings/recipients
// @access  Private/Meeting creators
//
// Priority (per product spec):
//   - a (trainee) team leader posting: their trainers come first, then everyone
//     else (juniors -> seniors).
//   - a head posting: the people in the teams they oversee come first, then all
//     the remaining people.
//   - CEO / Admin posting: no personal team, just everyone ordered by seniority.
exports.getRecipients = async (req, res) => {
  try {
    const creator = req.user;

    // Pool = all staff + admins, minus chairman (not in these role lists) and the
    // creator themselves.
    const pool = await User.find({
      role: { $in: [...FIELD_STAFF, ...ADMIN_ROLES] },
      _id: { $ne: creator._id },
    }).select('name role teamId teamLeaderId');

    // Resolve "my team" for the quick-select + priority ordering.
    const myTeam = new Set();
    if (LEADER_ROLES.includes(creator.role)) {
      // Trainers reporting directly to this leader.
      pool.forEach((u) => {
        if (String(u.teamLeaderId) === String(creator._id)) myTeam.add(String(u._id));
      });
    } else if (HEAD_ROLES.includes(creator.role)) {
      const headTeams = (creator.teamIds || []).map((t) => String(t));
      pool.forEach((u) => {
        if (u.teamId && headTeams.includes(String(u.teamId))) myTeam.add(String(u._id));
      });
    }

    const data = pool
      .map((u) => ({
        _id: u._id,
        name: u.name,
        role: u.role,
        isMyTeam: myTeam.has(String(u._id)),
      }))
      .sort((a, b) => {
        // My-team members always first.
        if (a.isMyTeam !== b.isMyTeam) return a.isMyTeam ? -1 : 1;
        // Then juniors -> seniors.
        const ra = ROLE_RANK[a.role] || 9;
        const rb = ROLE_RANK[b.role] || 9;
        if (ra !== rb) return ra - rb;
        return (a.name || '').localeCompare(b.name || '');
      });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('getRecipients error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

// @desc    Post a meeting link to the corner
// @route   POST /api/meetings
// @access  Private/Meeting creators
exports.createMeeting = async (req, res) => {
  try {
    const { link, agenda, recipientIds } = req.body;

    if (!link || !link.trim()) {
      return res.status(400).json({ success: false, message: 'A meeting link is required' });
    }
    if (!isValidMeetingLink(link)) {
      return res.status(400).json({ success: false, message: 'Please paste a valid meeting link.' });
    }
    if (!agenda || !agenda.trim()) {
      return res.status(400).json({ success: false, message: 'A meeting agenda is required' });
    }

    const ids = Array.isArray(recipientIds) ? [...new Set(recipientIds.map(String))] : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one person to share this meeting with.' });
    }

    // Keep only real, non-chairman users; never store the creator as a recipient.
    const validRecipients = await User.find({
      _id: { $in: ids },
      role: { $in: [...FIELD_STAFF, ...ADMIN_ROLES] },
    }).select('_id name role');
    const recipientIdSet = validRecipients
      .map((u) => String(u._id))
      .filter((id) => id !== String(req.user._id));

    if (recipientIdSet.length === 0) {
      return res.status(400).json({ success: false, message: 'None of the selected recipients are valid.' });
    }

    // Store the normalized (scheme-prefixed) link so "Join Now" always opens.
    const normalizedLink = normalizeUrl(link);
    const platform = detectPlatform(normalizedLink);

    const meeting = await Meeting.create({
      createdBy: req.user._id,
      link: normalizedLink,
      platform,
      agenda: agenda.trim(),
      recipients: recipientIdSet,
    });

    const populated = await populateMeeting(Meeting.findById(meeting._id));
    res.status(201).json({ success: true, data: populated });

    // ---- Notify selected recipients + ALWAYS Admin + CEO (in-app + push) ----
    const adminCeoIds = (await getAdminRecipientIds()).map((id) => String(id));
    const notifyIds = [...new Set([...recipientIdSet, ...adminCeoIds])].filter(
      (id) => id !== String(req.user._id)
    );

    notify(notifyIds, {
      type: 'meeting_new',
      title: `📹 New ${PLATFORM_LABEL[platform]} Meeting`,
      body: `${req.user.name} shared a meeting: ${agenda.trim()}`,
      data: { meetingId: String(meeting._id), platform },
    }).catch((e) => console.error('Meeting notify error:', e.message));
  } catch (error) {
    console.error('createMeeting error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// List / delete
// ---------------------------------------------------------------------------

// @desc    Meetings visible to the caller
// @route   GET /api/meetings
// @access  Private/Meeting viewers
//
// Admin + CEO see EVERY meeting (for sudden inspections). Everyone else sees the
// meetings shared with them plus the ones they posted.
exports.getMeetings = async (req, res) => {
  try {
    let query;
    if (isAdminRole(req.user.role)) {
      query = {};
    } else {
      query = { $or: [{ recipients: req.user._id }, { createdBy: req.user._id }] };
    }

    const meetings = await populateMeeting(Meeting.find(query)).sort({ createdAt: -1 }).limit(200);
    res.status(200).json({ success: true, data: meetings });
  } catch (error) {
    console.error('getMeetings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a meeting (creator or Admin only)
// @route   DELETE /api/meetings/:id
// @access  Private (creator or Admin)
exports.deleteMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    const isOwner = String(meeting.createdBy) === String(req.user._id);
    if (!isOwner && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to remove this meeting' });
    }

    await meeting.deleteOne();
    res.status(200).json({ success: true, data: { _id: meeting._id } });
  } catch (error) {
    console.error('deleteMeeting error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
