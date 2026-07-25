// Central role groupings so the new hierarchy stays consistent across
// controllers/routes instead of re-typing role-string lists everywhere.

// The three oversight roles that manage Teams. Zonal is intended to sit
// slightly higher, but for v1 all three share the same privileges.
const HEAD_ROLES = ['zonal_head', 'cluster_head', 'regional_head'];

// Roles that lead a team and can have trainers reporting to them.
// trainee_team_leader has full parity with team_leader (only the label differs).
const LEADER_ROLES = ['team_leader', 'trainee_team_leader'];

// Roles that are a "member" of a team (they carry a single teamId).
const TEAM_MEMBER_ROLES = ['team_leader', 'trainee_team_leader', 'trainer'];

// Everyone who does school field work (marks attendance, publishes activities,
// files reports). Heads are experienced team leaders/trainers, so they qualify.
const FIELD_STAFF = ['trainer', ...LEADER_ROLES, ...HEAD_ROLES];

// Top-level oversight logins that can see everything across the app. CEO is a
// read-only super-viewer (no create/manage), admin has full control. Both can
// log visit reports on any staff member.
const ADMIN_ROLES = ['creator_admin', 'ceo'];

// Everyone allowed to author a visit report (field staff + both admins).
const REPORT_AUTHORS = [...FIELD_STAFF, ...ADMIN_ROLES];

// Everyone who can apply for leave (all staff except the Admin + CEO logins).
// Same set as FIELD_STAFF today, aliased for intent/readability at call sites.
const LEAVE_APPLICANTS = [...FIELD_STAFF];

// Who decides leave requests — the Admin only (CEO is notified, not an approver).
const LEAVE_APPROVERS = ['creator_admin'];

// Meeting Corner: who can POST a meeting link (leaders, heads, CEO, Admin — not
// trainers, not chairman) vs who can VIEW the corner (all staff + admins).
const MEETING_CREATORS = [...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES];
const MEETING_VIEWERS = [...FIELD_STAFF, ...ADMIN_ROLES];

module.exports = { HEAD_ROLES, LEADER_ROLES, TEAM_MEMBER_ROLES, FIELD_STAFF, ADMIN_ROLES, REPORT_AUTHORS, LEAVE_APPLICANTS, LEAVE_APPROVERS, MEETING_CREATORS, MEETING_VIEWERS };
