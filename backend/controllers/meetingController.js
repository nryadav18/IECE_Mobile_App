const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { getAdminRecipientIds, getMeetingRecipientScopeFilter } = require('../utils/hierarchy');
const { detectPlatform, normalizeUrl, isValidMeetingLink } = require('../utils/meetingPlatform');
const {
  FIELD_STAFF, ADMIN_ROLES, LEADER_ROLES, HEAD_ROLES,
} = require('../utils/roles');
const { ROLE_LABELS } = require('../utils/roleLabels');
const { trail } = require('../utils/approvalTrail');
const { trackChanges } = require('../utils/changeSummary');

const roleLabel = (role) => ROLE_LABELS[role] || role;
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

/**
 * Id of a ref that may or may not be populated. Without this, a populated
 * `createdBy` stringifies to "[object Object]" and every id comparison in this
 * file silently stops matching.
 */
const idOf = (ref) => String(ref?._id || ref || '');
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
    .populate('updatedBy', 'name role')
    .populate('recipients', 'name role');

/**
 * Validate + normalize a meeting payload. Create and update enforce exactly the
 * same rules, so they share this rather than drifting apart.
 *
 * @param {object} body
 * @param {object} opts
 * @param {object} opts.actor      the user doing the posting/editing — their
 *                                 hierarchy scope bounds who may be selected
 * @param {*}      opts.creatorId  the meeting's creator, never a recipient
 * @returns {Promise<{ok:true, link, platform, agenda, recipientIds}|{ok:false, message}>}
 */
async function validateMeetingPayload({ link, agenda, recipientIds }, { actor, creatorId }) {
  if (!link || !link.trim()) {
    return { ok: false, message: 'A meeting link is required' };
  }
  if (!isValidMeetingLink(link)) {
    return { ok: false, message: 'Please paste a valid meeting link.' };
  }
  if (!agenda || !agenda.trim()) {
    return { ok: false, message: 'A meeting agenda is required' };
  }

  const ids = Array.isArray(recipientIds) ? [...new Set(recipientIds.map(String))] : [];
  if (ids.length === 0) {
    return { ok: false, message: 'Please select at least one person to share this meeting with.' };
  }

  // The picker only OFFERS people inside the actor's scope, but the scope has to
  // be enforced here too — otherwise a hand-crafted request could share a
  // meeting with anyone in the organisation.
  const inScope = await User.find({
    _id: { $in: ids },
    ...getMeetingRecipientScopeFilter(actor),
  }).select('_id');

  const creator = idOf(creatorId);
  const resolved = inScope.map((u) => idOf(u._id)).filter((id) => id !== creator);

  if (resolved.length === 0) {
    return { ok: false, message: 'None of the selected recipients are valid.' };
  }

  // Reject rather than silently drop: quietly shrinking the list would leave the
  // poster believing people were included who never were.
  const expected = ids.filter((id) => id !== creator);
  if (resolved.length !== expected.length) {
    return {
      ok: false,
      message: 'Some of the selected people are outside the group you can share meetings with. Please refresh and choose again.',
    };
  }

  // Store the normalized (scheme-prefixed) link so "Join Now" always opens.
  const normalizedLink = normalizeUrl(link);
  return {
    ok: true,
    link: normalizedLink,
    platform: detectPlatform(normalizedLink),
    agenda: agenda.trim(),
    recipientIds: resolved,
  };
}

/** Everyone who must hear about a meeting: its recipients, plus Admin + CEO. */
async function meetingAudience(recipientIds, actorId) {
  const adminCeoIds = (await getAdminRecipientIds()).map(idOf);
  const actor = idOf(actorId);
  return [...new Set([...recipientIds, ...adminCeoIds])].filter((id) => id !== actor);
}

/** Creator or Admin may change a meeting; everyone else is read-only. */
function canManage(meeting, user) {
  return idOf(meeting.createdBy) === idOf(user._id) || user.role === 'creator_admin';
}

// ---------------------------------------------------------------------------
// Recipient picker
// ---------------------------------------------------------------------------

// @desc    Candidate recipients for the caller, ORDERED by priority + flagged
//          with isMyTeam so the client can offer "All" / "My Team" quick-selects.
// @route   GET /api/meetings/recipients
// @access  Private/Meeting creators
//
// Scope (who is even offered) — see getMeetingRecipientScopeFilter:
//   - Admin / CEO: everyone in the organisation, including each other.
//   - Head (zonal / cluster / regional): only the trainers + leaders in the
//     teams they oversee.
//   - (Trainee) team leader: only the trainers reporting to them.
// Admin + CEO are always notified about every meeting regardless, so a head or
// leader loses nothing by not being able to tick them.
exports.getRecipients = async (req, res) => {
  try {
    const creator = req.user;

    // Pool = the people this person manages (everyone, for Admin/CEO), minus
    // chairman (never in these role lists) and the creator themselves.
    const pool = await User.find({
      ...getMeetingRecipientScopeFilter(creator),
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

    // The server owns the scoping rule, so it also describes it — otherwise a
    // leader seeing a short list has no way to tell a restriction from a bug.
    let scope;
    if (isAdminRole(creator.role)) {
      scope = { key: 'all', label: 'Everyone', hint: 'You can share with anyone in the organisation.' };
    } else if (HEAD_ROLES.includes(creator.role)) {
      scope = {
        key: 'my_teams',
        label: 'My teams',
        hint: 'You can share with the people in the teams you oversee. The Admin and CEO are always notified as well.',
      };
    } else {
      scope = {
        key: 'my_team',
        label: 'My team',
        hint: 'You can share with the people who report to you. The Admin and CEO are always notified as well.',
      };
    }

    res.status(200).json({ success: true, data, scope });
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
    const v = await validateMeetingPayload(req.body, { actor: req.user, creatorId: req.user._id });
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });

    const meeting = await Meeting.create({
      createdBy: req.user._id,
      link: v.link,
      platform: v.platform,
      agenda: v.agenda,
      recipients: v.recipientIds,
    });

    const populated = await populateMeeting(Meeting.findById(meeting._id));
    res.status(201).json({ success: true, data: populated });

    trail({
      entityType: 'meeting',
      entityId: meeting._id,
      entityLabel: `${PLATFORM_LABEL[v.platform]} · ${v.agenda}`,
      subject: req.user,
      actor: req.user,
      action: 'created',
      note: `Shared with ${v.recipientIds.length} recipient(s).`,
    });

    // ---- Notify selected recipients + ALWAYS Admin + CEO (in-app + push) ----
    const notifyIds = await meetingAudience(v.recipientIds, req.user._id);

    notify(notifyIds, {
      type: 'meeting_new',
      title: `📹 New ${PLATFORM_LABEL[v.platform]} Meeting`,
      body: `${req.user.name} shared a meeting: ${v.agenda}`,
      data: { meetingId: String(meeting._id), platform: v.platform },
    }).catch((e) => console.error('Meeting notify error:', e.message));
  } catch (error) {
    console.error('createMeeting error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

// @desc    Edit a meeting (creator or Admin only) and re-notify everyone
// @route   PUT /api/meetings/:id
// @access  Private (creator or Admin)
//
// Any field may change — link, agenda, or who it is shared with. Because the
// recipient list itself can change, the people notified are the ones on the
// meeting AFTER the edit (plus Admin + CEO, who always hear about it). Anyone
// dropped from the list simply stops seeing the meeting in their corner, since
// the feed query is driven by `recipients`.
exports.updateMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    if (!canManage(meeting, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this meeting' });
    }

    // Two different people matter here. The EDITOR's hierarchy bounds who can be
    // picked (an admin editing a leader's meeting may add anyone). The CREATOR
    // is who must never appear as a recipient of their own meeting.
    const v = await validateMeetingPayload(req.body, {
      actor: req.user,
      creatorId: meeting.createdBy,
    });
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });

    // Snapshot before the assignments below overwrite it.
    const before = {
      link: meeting.link,
      platform: meeting.platform,
      agenda: meeting.agenda,
      recipients: (meeting.recipients || []).map(String),
      createdBy: meeting.createdBy,
    };

    meeting.link = v.link;
    meeting.platform = v.platform;
    meeting.agenda = v.agenda;
    meeting.recipients = v.recipientIds;
    meeting.updatedBy = req.user._id;
    await meeting.save();

    const populated = await populateMeeting(Meeting.findById(meeting._id));
    res.status(200).json({ success: true, data: populated });

    // The link itself is never written into the log: a meeting URL is a
    // join credential, and an audit row is read by more people than the
    // meeting was ever shared with. That it changed is the auditable fact.
    const changes = trackChanges()
      .field('agenda', before.agenda, meeting.agenda)
      .field('platform', before.platform, meeting.platform,
        (p) => PLATFORM_LABEL[p] || p)
      .count('recipients', before.recipients, (meeting.recipients || []).map(String));
    if (before.link !== meeting.link) changes.secret('link', 'replaced');

    if (changes.changed) {
      trail({
        entityType: 'meeting',
        entityId: meeting._id,
        entityLabel: `${PLATFORM_LABEL[meeting.platform]} · ${meeting.agenda}`,
        subject: before.createdBy,
        actor: req.user,
        action: 'updated',
        note: changes.summary(),
      });
    }

    // ---- Re-notify the (possibly changed) audience + ALWAYS Admin + CEO ----
    const notifyIds = await meetingAudience(v.recipientIds, req.user._id);

    notify(notifyIds, {
      type: 'meeting_updated',
      title: `✏️ ${PLATFORM_LABEL[v.platform]} Meeting Updated`,
      body: `${req.user.name} updated a meeting: ${v.agenda}`,
      data: { meetingId: String(meeting._id), platform: v.platform },
    }).catch((e) => console.error('Meeting update notify error:', e.message));
  } catch (error) {
    console.error('updateMeeting error:', error);
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

// @desc    One meeting in full (for the detail view / notification deep-link)
// @route   GET /api/meetings/:id
// @access  Private/Meeting viewers — must be on it, have posted it, or be Admin/CEO
exports.getMeeting = async (req, res) => {
  try {
    const meeting = await populateMeeting(Meeting.findById(req.params.id));
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    // Same visibility rule as the feed: Admin + CEO see everything, everyone
    // else only what was shared with them or what they posted.
    const me = String(req.user._id);
    const isRecipient = (meeting.recipients || []).some((r) => String(r?._id || r) === me);
    const isOwner = String(meeting.createdBy?._id || meeting.createdBy) === me;
    if (!isAdminRole(req.user.role) && !isRecipient && !isOwner) {
      return res.status(403).json({ success: false, message: 'This meeting was not shared with you' });
    }

    res.status(200).json({ success: true, data: meeting });
  } catch (error) {
    console.error('getMeeting error:', error);
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

    if (!canManage(meeting, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove this meeting' });
    }

    // Read before deleteOne() — a moment later there is no agenda to name.
    const snapshot = {
      _id: meeting._id,
      agenda: meeting.agenda,
      platform: meeting.platform,
      createdBy: meeting.createdBy,
      recipients: (meeting.recipients || []).length,
    };

    await meeting.deleteOne();
    res.status(200).json({ success: true, data: { _id: meeting._id } });

    trail({
      entityType: 'meeting',
      entityId: snapshot._id,
      entityLabel: `${PLATFORM_LABEL[snapshot.platform]} · ${snapshot.agenda}`,
      subject: snapshot.createdBy,
      actor: req.user,
      action: 'deleted',
      note: `Meeting removed from the corner. It was shared with ${snapshot.recipients} recipient(s).`,
    });
  } catch (error) {
    console.error('deleteMeeting error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
