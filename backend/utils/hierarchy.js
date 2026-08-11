const { HEAD_ROLES, LEADER_ROLES, ADMIN_ROLES, FIELD_STAFF, TEAM_MEMBER_ROLES } = require('./roles');

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
 * The (trainee) team leader ids of a given team.
 *
 * A trainer normally points at their leader through teamLeaderId, but that link
 * is optional — an admin can drop someone into a team without picking a leader.
 * Resolving leaders from the team as well means the trainer still has a real
 * approver above them instead of silently falling through to the admin.
 */
async function getLeaderIdsOfTeam(teamId) {
  if (!teamId) return [];
  const leaders = await getUser()
    .find({ role: { $in: LEADER_ROLES }, teamId })
    .select('_id');
  return leaders.map((l) => l._id);
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
 * A Mongo filter describing who a given user may SHARE A MEETING with — i.e.
 * the people who work under them.
 *
 *   Admin / CEO  -> everybody, including each other. They sit above the whole
 *                   organisation, so nothing is hidden from them.
 *   Head          -> the trainers + (trainee) team leaders in the teams they
 *                   oversee. Zonal, cluster and regional heads share this rule.
 *   Team leader   -> the trainers reporting to them.
 *   Anyone else   -> nobody (they cannot post meetings at all).
 *
 * Sibling of getSubjectScopeFilter, deliberately kept separate: that one answers
 * "who may I raise a substitution against" and covers only field staff, whereas
 * a meeting may legitimately be shared with the Admin and CEO.
 *
 * Admin + CEO are ALWAYS notified about every meeting and can always open any
 * of them, so leaving them out of a head's or leader's list costs nothing — it
 * only keeps the picker to the people that person actually manages.
 *
 * @param {object} user - Mongoose user doc (needs role, _id, teamIds)
 * @returns {object} a Mongoose query filter
 */
function getMeetingRecipientScopeFilter(user) {
  if (ADMIN_ROLES.includes(user.role)) {
    return { role: { $in: [...FIELD_STAFF, ...ADMIN_ROLES] } };
  }
  if (HEAD_ROLES.includes(user.role)) {
    return { role: { $in: FIELD_STAFF }, teamId: { $in: user.teamIds || [] } };
  }
  if (LEADER_ROLES.includes(user.role)) {
    return { role: { $in: FIELD_STAFF }, teamLeaderId: user._id };
  }
  return { _id: { $in: [] } };
}

/**
 * Everyone allowed to APPROVE OR REJECT an ACTIVITY uploaded by `subject`.
 *
 * Facial registrations used to run through here too. They no longer do — they
 * are the Admin's alone now (see FACE_APPROVERS in roles.js) — so this describes
 * the activity chain of command only.
 *
 *   trainer                     -> their team leader (the explicit teamLeaderId
 *                                  link AND the leaders of their team) plus the
 *                                  head(s) overseeing that team
 *   team / trainee team leader  -> the head(s) overseeing their team
 *   head                        -> Admin + CEO
 *
 * Approval rights are CUMULATIVE up the chain: a head oversees whole teams, so
 * everything inside those teams — trainers included, not just the leaders — is
 * theirs to decide. Restricting a trainer's request to their team leader alone
 * left heads with an empty Approvals tab for people they are responsible for.
 *
 * Admin and CEO are ALWAYS included on top of that, holding a full override at
 * every level. Without it a trainer whose team leader is on leave, has left, or
 * simply never acts would be stuck unable to mark attendance at all.
 *
 * The same set drives BOTH the notification ("who should be told this needs a
 * decision") and the permission check ("may this person decide it"), so the
 * people who get asked are exactly the people who can act — they can never
 * drift apart. getApprovalSubjectFilter is the query-shaped mirror of this
 * function; the two must stay in step.
 *
 * @param {object} subject - Mongoose user doc (needs role, _id, teamId, teamLeaderId)
 * @returns {Promise<string[]>} de-duplicated approver ids (strings)
 */
async function getApproverIdsFor(subject) {
  const ids = new Set();
  if (!subject) return [];

  if (subject.role === 'trainer') {
    if (subject.teamLeaderId) ids.add(idStr(subject.teamLeaderId));
    (await getLeaderIdsOfTeam(subject.teamId)).forEach((id) => ids.add(idStr(id)));
    (await getHeadIdsOverTeam(subject.teamId)).forEach((id) => ids.add(idStr(id)));
  } else if (LEADER_ROLES.includes(subject.role)) {
    (await getHeadIdsOverTeam(subject.teamId)).forEach((id) => ids.add(idStr(id)));
  }
  // Heads answer to Admin + CEO, who are also the safety net for anyone whose
  // own approver could not be resolved (no team leader assigned yet, a team
  // with no head over it, and so on).
  (await getAdminRecipientIds()).forEach((id) => ids.add(idStr(id)));

  // Nobody approves their own request.
  ids.delete(idStr(subject._id));
  return [...ids];
}

/**
 * May `actor` decide a request raised by `subject`?
 * Thin wrapper over getApproverIdsFor so permission and notification can never
 * disagree about who is in charge.
 */
async function canApproveFor(actor, subject) {
  if (!actor || !subject) return false;
  const approvers = await getApproverIdsFor(subject);
  return approvers.includes(idStr(actor._id));
}

/**
 * The query-shaped mirror of getApproverIdsFor: a Mongo filter matching every
 * person whose requests `actor` may decide. Read it top-down as "who is under
 * me":
 *
 *   Admin / CEO   -> all field staff, at every level
 *   Head          -> everyone inside the teams they oversee — trainers, team
 *                    leaders and trainee team leaders alike
 *   Team leader   -> the trainers assigned to them, plus any trainer sitting in
 *                    their own team (the teamLeaderId link is optional)
 *   Anyone else   -> nobody
 *
 * Asking the database "who is under me" instead of testing every candidate one
 * by one keeps the Approvals tab a single query no matter how many staff exist.
 *
 * @param {object} actor - Mongoose user doc (needs role, _id, teamId, teamIds)
 * @returns {object|null} a Mongoose query filter, or null when nobody is in scope
 */
function getApprovalSubjectFilter(actor) {
  if (!actor) return null;

  if (ADMIN_ROLES.includes(actor.role)) {
    return { role: { $in: FIELD_STAFF }, _id: { $ne: actor._id } };
  }

  if (HEAD_ROLES.includes(actor.role)) {
    const teams = (actor.teamIds || []).filter(Boolean);
    if (teams.length === 0) return null;
    return {
      role: { $in: TEAM_MEMBER_ROLES },
      teamId: { $in: teams },
      _id: { $ne: actor._id },
    };
  }

  if (LEADER_ROLES.includes(actor.role)) {
    const links = [{ teamLeaderId: actor._id }];
    if (actor.teamId) links.push({ teamId: actor.teamId });
    return { role: 'trainer', $or: links, _id: { $ne: actor._id } };
  }

  // Trainers (and the chairman login) approve nothing.
  return null;
}

/**
 * How to describe the approver in a message shown to the requester, e.g.
 * "…sent to your team leader for approval".
 *
 * Takes the whole subject rather than just their role so it can tell the truth
 * when the normal approver does not exist — a trainer with no team leader is
 * waiting on the admin, and saying otherwise would send them chasing nobody.
 */
function approverLabelFor(subject) {
  const role = typeof subject === 'string' ? subject : subject?.role;
  const doc = typeof subject === 'string' ? null : subject;

  if (role === 'trainer') {
    // No leader link and no team means nobody above them but the admin; a team
    // on its own is enough, since its leaders and heads can both decide.
    if (doc && !doc.teamLeaderId && !doc.teamId) return 'the admin';
    return 'your team leader';
  }
  if (LEADER_ROLES.includes(role)) {
    return doc && !doc.teamId ? 'the admin' : 'your head';
  }
  return 'the admin';
}

/**
 * Recipients for an APPROVED substitution: ONLY the people the substitution
 * actually concerns —
 *   - the person being replaced (subject) and the substitute themselves
 *   - whoever raised the request
 *   - the subject's direct team leader (they lose a team member)
 *   - the heads overseeing the subject's team
 *   - Admin + CEO
 *
 * This deliberately does NOT fan out to every member of both teams. That older
 * "team circle" behaviour meant a routine substitution notified (and emailed)
 * a dozen-plus uninvolved colleagues, which is exactly the notification noise
 * the app was asked to stop. Teammates who need to know are told by their
 * leader; the app only notifies people with a stake in the decision.
 *
 * @param {object} subject    - user doc of the person being replaced
 * @param {object} substitute - user doc of the person covering
 * @param {object|string} raiser - user doc (or id) of whoever raised it
 * @returns {Promise<string[]>} de-duplicated recipient ids (strings)
 */
async function getSubstitutionApprovalRecipientIds(subject, substitute, raiser) {
  const ids = new Set();

  if (subject) ids.add(idStr(subject._id));
  if (substitute) ids.add(idStr(substitute._id));
  if (raiser) ids.add(idStr(raiser._id || raiser));

  if (subject) {
    // The subject's direct team leader — they are the one who has to work
    // around the gap, so they are the one teammate who is always told.
    if (subject.teamLeaderId) ids.add(idStr(subject.teamLeaderId));

    // Heads overseeing the subject's team.
    if (subject.teamId) {
      (await getHeadIdsOverTeam(subject.teamId)).forEach((id) => ids.add(idStr(id)));
    }
    // A head carries teamIds rather than a single teamId; notify the heads who
    // share oversight of those teams.
    for (const t of subject.teamIds || []) {
      (await getHeadIdsOverTeam(t)).forEach((id) => ids.add(idStr(id)));
    }
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

/**
 * Recipients for an APPROVED school visit: the person themselves, their team
 * leader, the heads over their team, and the CEO — the same reporting line as
 * an approved leave, because those are the people who need to know a staff
 * member is off-site.
 *
 * The Admin is the approver (acts, isn't re-notified), and the visited school's
 * chairman is deliberately NOT notified — chairmen never see staff attendance
 * status, exactly as with leave and substitution.
 *
 * @param {object} applicant - Mongoose user doc (role, _id, teamId, teamLeaderId, teamIds)
 * @returns {Promise<string[]>} de-duplicated recipient ids (strings)
 */
async function getSchoolVisitApprovalRecipientIds(applicant) {
  const ids = new Set();

  ids.add(idStr(applicant._id));

  if (applicant.teamLeaderId) ids.add(idStr(applicant.teamLeaderId));

  if (applicant.teamId) {
    (await getHeadIdsOverTeam(applicant.teamId)).forEach((id) => ids.add(idStr(id)));
  }
  // Heads carry teamIds instead of a single teamId.
  for (const t of applicant.teamIds || []) {
    (await getHeadIdsOverTeam(t)).forEach((id) => ids.add(idStr(id)));
  }

  (await getCeoRecipientIds()).forEach((id) => ids.add(idStr(id)));

  return [...ids];
}

module.exports = {
  getAdminRecipientIds,
  getAdminOnlyRecipientIds,
  getCeoRecipientIds,
  getHeadIdsOverTeam,
  getLeaderIdsOfTeam,
  getUpwardRecipientIds,
  getSubjectScopeFilter,
  getMeetingRecipientScopeFilter,
  getApproverIdsFor,
  canApproveFor,
  getApprovalSubjectFilter,
  approverLabelFor,
  getSubstitutionApprovalRecipientIds,
  getLeaveApprovalRecipientIds,
  getSchoolVisitApprovalRecipientIds,
};
