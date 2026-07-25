const { HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES, FIELD_STAFF } = require('./roles');

// Lazy require to avoid load-order coupling with the User model.
const getUser = () => require('../models/User');

// The hierarchy is not a manager chain — it is derived through Teams:
//   trainer / leader  ->  carries a single teamId
//   head              ->  oversees many teams via teamIds[]
//   trainer           ->  also links to its leader via teamLeaderId
// These helpers resolve "who is above me" (for raise notifications) and "who is
// around these people" (for approval broadcasts) from that shape.

const idStr = (v) => String(v && v._id ? v._id : v);

/**
 * All CEO + Admin user ids. Every substitution event notifies these two.
 */
async function getAdminRecipientIds() {
  const admins = await getUser().find({ role: { $in: ADMIN_ROLES } }).select('_id');
  return admins.map((a) => a._id);
}

/**
 * Head user ids overseeing a given team (heads carry the team in teamIds[]).
 */
async function getHeadIdsOverTeam(teamId) {
  if (!teamId) return [];
  const heads = await getUser()
    .find({ role: { $in: HEAD_ROLES }, teamIds: teamId })
    .select('_id');
  return heads.map((h) => h._id);
}

/**
 * Recipients for a RAISED request: everyone up the raiser's hierarchy plus the
 * always-included CEO + Admin. The raiser themselves is excluded.
 *
 *  - leader / trainer raises -> all heads overseeing their team + CEO + Admin
 *  - head raises             -> CEO + Admin (nothing ranked above a head today)
 *  - CEO / Admin raises       -> the other admin-role logins (routing handled by
 *                                the controller)
 *
 * @param {object} raiser - Mongoose user doc (needs role, teamId, _id)
 * @returns {Promise<string[]>} de-duplicated recipient ids (strings)
 */
async function getUpwardRecipientIds(raiser) {
  const ids = new Set();

  (await getAdminRecipientIds()).forEach((id) => ids.add(idStr(id)));

  if (LEADER_ROLES.includes(raiser.role) || raiser.role === 'trainer') {
    (await getHeadIdsOverTeam(raiser.teamId)).forEach((id) => ids.add(idStr(id)));
  }
  // Heads have no ranked level above them — CEO + Admin (already added) suffice.

  ids.delete(idStr(raiser._id));
  return [...ids];
}

/**
 * A Mongo filter describing which staff a given user may raise a request
 * against (the subject picker list). Role-scoped so each tier only sees its own
 * subtree; CEO/Admin see all field staff.
 *
 * @param {object} user - Mongoose user doc (needs role, _id, teamId, teamIds)
 * @returns {object} a Mongoose query filter
 */
function getSubjectScopeFilter(user) {
  if (ADMIN_ROLES.includes(user.role)) {
    // CEO + Admin can raise against any working field staff member.
    return { role: { $in: FIELD_STAFF } };
  }
  if (HEAD_ROLES.includes(user.role)) {
    // A head sees every leader + trainer in the teams they oversee.
    return { teamId: { $in: user.teamIds || [] } };
  }
  if (LEADER_ROLES.includes(user.role)) {
    // A leader sees the trainers reporting to them.
    return { teamLeaderId: user._id };
  }
  // Trainers (and anyone else) cannot raise requests — empty scope.
  return { _id: { $in: [] } };
}

/**
 * Recipients for an APPROVED substitution: everyone in the team circle of BOTH
 * the subject and the substitute (their teammates + the heads overseeing those
 * teams), plus the two people themselves, plus CEO + Admin.
 *
 * @param {Array<object>} persons - user docs (subject, substitute)
 * @returns {Promise<string[]>} de-duplicated recipient ids (strings)
 */
async function getTeamCircleRecipientIds(persons) {
  const User = getUser();
  const ids = new Set();
  const teamIds = new Set();

  for (const p of persons) {
    if (!p) continue;
    ids.add(idStr(p._id));
    if (p.teamId) teamIds.add(idStr(p.teamId));
    (p.teamIds || []).forEach((t) => teamIds.add(idStr(t)));
  }

  const involvedTeams = [...teamIds];
  if (involvedTeams.length > 0) {
    // Every member of any involved team (leaders + trainers).
    const members = await User.find({ teamId: { $in: involvedTeams } }).select('_id');
    members.forEach((m) => ids.add(idStr(m._id)));
    // Every head overseeing any involved team.
    const heads = await User.find({
      role: { $in: HEAD_ROLES },
      teamIds: { $in: involvedTeams }
    }).select('_id');
    heads.forEach((h) => ids.add(idStr(h._id)));
  }

  (await getAdminRecipientIds()).forEach((id) => ids.add(idStr(id)));

  return [...ids];
}

/**
 * Only the Admin login(s) (creator_admin). A leave request is raised to the
 * Admin ONLY, so this is who gets the "new leave request" notification.
 */
async function getAdminOnlyRecipientIds() {
  const admins = await getUser().find({ role: 'creator_admin' }).select('_id');
  return admins.map((a) => a._id);
}

/**
 * The CEO login(s). Notified when a leave is approved (but not the approver).
 */
async function getCeoRecipientIds() {
  const ceos = await getUser().find({ role: 'ceo' }).select('_id');
  return ceos.map((c) => c._id);
}

/**
 * Recipients for an APPROVED leave: the applicant themselves + everyone up their
 * hierarchy + the CEO. Mirrors the request the user described:
 *   trainer approved -> the trainer + their team leader + the heads over their
 *                       team + CEO
 *   leader approved  -> the leader + the heads over their team + CEO
 *   head approved    -> the head + CEO (nothing ranked above a head today)
 *
 * The Admin is the approver (acts, isn't re-notified). Deduplicated.
 *
 * @param {object} applicant - Mongoose user doc (needs role, _id, teamId, teamLeaderId)
 * @returns {Promise<string[]>} de-duplicated recipient ids (strings)
 */
async function getLeaveApprovalRecipientIds(applicant) {
  const ids = new Set();

  ids.add(idStr(applicant._id));

  // A trainer's direct team leader.
  if (applicant.teamLeaderId) ids.add(idStr(applicant.teamLeaderId));

  // Heads overseeing the applicant's team (trainers + leaders carry a teamId).
  if (applicant.teamId) {
    (await getHeadIdsOverTeam(applicant.teamId)).forEach((id) => ids.add(idStr(id)));
  }

  // Always the CEO.
  (await getCeoRecipientIds()).forEach((id) => ids.add(idStr(id)));

  return [...ids];
}

module.exports = {
  getAdminRecipientIds,
  getAdminOnlyRecipientIds,
  getCeoRecipientIds,
  getHeadIdsOverTeam,
  getUpwardRecipientIds,
  getSubjectScopeFilter,
  getTeamCircleRecipientIds,
  getLeaveApprovalRecipientIds,
};
