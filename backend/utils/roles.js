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

module.exports = { HEAD_ROLES, LEADER_ROLES, TEAM_MEMBER_ROLES, FIELD_STAFF, ADMIN_ROLES, REPORT_AUTHORS };
