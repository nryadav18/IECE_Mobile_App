const { ADMIN_ROLES, HEAD_ROLES, LEADER_ROLES } = require('./roles');

// ---------------------------------------------------------------------------
// WHOSE DAY DOES THIS VIEWER GET TO SEE?
//
// The Monitoring dashboard is one screen, but it is never one dataset. What the
// Admin sees is the whole organisation; what a head sees is the teams assigned
// to them; what a (trainee) team leader sees is the trainers working under
// them. Nobody ever receives a row for somebody outside their scope — the
// filtering happens on the server, before the payload is built, so there is no
// client-side "hidden" data to leak through a drill-down or a socket frame.
//
// The rules deliberately mirror getApprovalSubjectFilter in utils/hierarchy.js
// ("who is under me"), so the people a viewer can monitor are exactly the people
// whose work they are already responsible for. If one of the two ever moves,
// the other has to move with it.
//
// A viewer never appears in their own dashboard: this answers "how are MY
// PEOPLE doing", not "how am I doing" — everyone already has their own
// attendance calendar for that.
// ---------------------------------------------------------------------------

const idStr = (v) => (v == null ? null : String(v._id ? v._id : v));

/**
 * The scope descriptor for a viewer, or null if they may not monitor anyone.
 *
 * `key` identifies the RESULTING VIEW rather than the person: two sockets with
 * the same key are guaranteed to receive byte-identical snapshots, which is what
 * lets the realtime ticker build the organisation once and project it once per
 * distinct audience instead of once per connection. It therefore folds in the
 * teams the scope is derived from — re-assign a head's teams and they get a new
 * key rather than a stale view.
 *
 * @param {object} user - Mongoose user doc (needs role, _id, teamId, teamIds)
 */
function monitoringScopeFor(user) {
  if (!user || !user.role) return null;
  const viewerId = idStr(user._id);

  if (ADMIN_ROLES.includes(user.role)) {
    return { kind: 'org', key: 'org', viewerId, label: 'Whole organisation' };
  }

  if (HEAD_ROLES.includes(user.role)) {
    const teamIds = [...new Set((user.teamIds || []).map(idStr).filter(Boolean))].sort();
    return {
      kind: 'head',
      key: `head:${viewerId}:${teamIds.join(',')}`,
      viewerId,
      teamIds,
      label: teamIds.length === 1 ? 'My team' : 'My teams',
    };
  }

  if (LEADER_ROLES.includes(user.role)) {
    const teamId = idStr(user.teamId);
    return {
      kind: 'leader',
      key: `leader:${viewerId}:${teamId || ''}`,
      viewerId,
      teamId,
      label: 'My trainers',
    };
  }

  // Trainers and the chairman login manage nobody.
  return null;
}

/**
 * Is this person inside the viewer's scope?
 *
 * Operates on a snapshot `people` row (which already carries teamId, leaderId
 * and role) rather than on a database document, so the whole organisation can be
 * aggregated once and then sliced per audience in memory.
 */
function personInScope(scope, person) {
  if (!scope || !person) return false;
  if (person.id === scope.viewerId) return false;      // never yourself

  if (scope.kind === 'org') return true;

  if (scope.kind === 'head') {
    // Everyone inside the teams this head oversees — trainers and leaders
    // alike. Heads carry teamIds rather than a teamId, so a fellow head can
    // never match here, which is the intent: heads are peers, not reports.
    return !!person.teamId && scope.teamIds.includes(person.teamId);
  }

  if (scope.kind === 'leader') {
    // The trainers pointed at this leader, plus any trainer sitting in their
    // team without an explicit link — the teamLeaderId link is optional, and a
    // leader is still responsible for an unlinked trainer in their own team.
    if (person.role !== 'trainer') return false;
    if (person.leaderId && person.leaderId === scope.viewerId) return true;
    return !!scope.teamId && person.teamId === scope.teamId;
  }

  return false;
}

module.exports = { monitoringScopeFor, personInScope };
