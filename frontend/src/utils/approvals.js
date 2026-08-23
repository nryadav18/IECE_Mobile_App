// "Approved by <name>" — the one place the rules for that line live.
//
// There are several admins and one CEO, and until now an approval left no trace
// of WHICH of them made it. Every approvable record in the app therefore carries
// a `decidedBy` snapshot ({ userId, name, role, action, at }) stamped by the
// server at decision time, and this module turns that snapshot into the text
// shown on cards, detail screens and reports.
//
// The backend also strips `decidedBy` from every response sent to anyone who is
// not Admin/CEO, so the helpers here are the second lock on that door, not the
// only one.

import { ADMIN_ROLES, roleLabel } from './roles';

// Who is allowed to see an approver's identity, anywhere in the app.
export const canSeeApprover = (user) => ADMIN_ROLES.includes(user?.role);

// action → the verb shown in bold. Falls back to the record's status when a
// pre-feature record has no action stored.
const ACTION_LABELS = {
  approved: 'Approved by',
  auto_approved: 'Approved by',
  rejected: 'Rejected by',
  cancelled: 'Cancelled by',
  withdrawn: 'Withdrawn by',
  granted: 'Granted by',
  revised: 'Dates set by',
  created: 'Created by',
  deleted: 'Deleted by',
  // The item is still there — only its photos/videos were removed from cloud
  // storage. Deliberately a different verb from 'deleted': in an audit log,
  // "the activity is gone" and "the activity's photos are gone" must never
  // read the same.
  media_deleted: 'Photos removed by',
};

const STATUS_FALLBACK = {
  approved: 'Approved by',
  rejected: 'Rejected by',
  cancelled: 'Cancelled by',
};

// Colour per action, so the line reads at a glance without having to parse it.
// Deliberately the same palette as StatusBadge.
const ACTION_COLORS = {
  approved: '#27AE60',
  auto_approved: '#27AE60',
  granted: '#27AE60',
  rejected: '#F44336',
  cancelled: '#888888',
  withdrawn: '#888888',
  revised: '#0D9488',
  created: '#2563EB',
  deleted: '#F44336',
  // Amber, not red: something was destroyed, but the record survived.
  media_deleted: '#F59E0B',
};

const ACTION_ICONS = {
  approved: 'shield-checkmark',
  auto_approved: 'shield-checkmark',
  granted: 'flash',
  rejected: 'close-circle',
  cancelled: 'remove-circle',
  withdrawn: 'return-down-back',
  revised: 'calendar',
  created: 'person-add',
  deleted: 'trash',
  media_deleted: 'images-outline',
};

export const decisionVerb = (action, status) =>
  ACTION_LABELS[action] || STATUS_FALLBACK[status] || 'Decided by';

export const decisionColor = (action, status) =>
  ACTION_COLORS[action] || ACTION_COLORS[status] || '#888888';

export const decisionIcon = (action, status) =>
  ACTION_ICONS[action] || ACTION_ICONS[status] || 'shield-checkmark';

// "Ravi Kumar (Admin)" — the approver, exactly as it should read everywhere.
export const approverName = (decidedBy) => {
  if (!decidedBy || !decidedBy.name) return null;
  const label = roleLabel(decidedBy.role);
  return label ? `${decidedBy.name} (${label})` : decidedBy.name;
};

// "11 Aug 2026, 4:30 PM". Kept separate from prettyDate because a decision is a
// moment, not a day: two admins acting on the same request hours apart is
// exactly the case this feature exists to untangle.
export const decisionMoment = (at) => {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
};

// A decided record with no snapshot predates this feature. Say so — an empty
// space would read as "nobody approved it", which is a different and wrong
// claim, and "Pending" is a different state again.
export const DECIDED_STATUSES = ['approved', 'rejected', 'cancelled'];

export const hasDecision = (status) => DECIDED_STATUSES.includes(status);

/**
 * Everything a caller needs to render the line, or null when there is nothing
 * to render (still pending, or the viewer is not allowed to see it).
 *
 *   { verb, name, moment, color, icon, recorded }
 *
 * `recorded: false` means the item WAS decided but by whom is not on record.
 */
export const decisionSummary = (record, user) => {
  if (!record || !canSeeApprover(user)) return null;
  const status = record.status;
  const decidedBy = record.decidedBy;
  if (!decidedBy && !hasDecision(status)) return null;

  const action = decidedBy?.action || status;
  const name = approverName(decidedBy);

  return {
    verb: decisionVerb(action, status),
    name,
    moment: decisionMoment(decidedBy?.at),
    color: decisionColor(action, status),
    icon: decisionIcon(action, status),
    recorded: !!name,
  };
};
