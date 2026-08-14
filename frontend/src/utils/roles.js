// Central role groupings for the client, mirroring backend/utils/roles.js so
// role handling stays consistent instead of scattering role strings around.

export const HEAD_ROLES = ['zonal_head', 'cluster_head', 'regional_head'];
export const LEADER_ROLES = ['team_leader', 'trainee_team_leader'];
export const TEAM_MEMBER_ROLES = ['team_leader', 'trainee_team_leader', 'trainer'];
// Top-level oversight logins. CEO is a read-only super-viewer; admin has full control.
export const ADMIN_ROLES = ['creator_admin', 'ceo'];
// Everyone a visit report can be logged on (all field staff).
export const REPORT_TARGET_ROLES = ['team_leader', 'trainee_team_leader', 'trainer', 'zonal_head', 'cluster_head', 'regional_head'];

// Everyone who can apply for leave — all staff except the Admin + CEO logins.
export const LEAVE_APPLICANT_ROLES = ['trainer', ...LEADER_ROLES, ...HEAD_ROLES];

// Whether a role has access to the Leave screen at all (applicants + the Admin approver).
export const canUseLeave = (role) => LEAVE_APPLICANT_ROLES.includes(role) || role === 'creator_admin';

// School Visit (inspection attendance): only leaders and heads go out on
// inspection duty. Trainers stay at their school, and chairman/Admin/CEO never
// raise one — deliberately narrower than LEAVE_APPLICANT_ROLES.
export const SCHOOL_VISIT_APPLICANT_ROLES = [...LEADER_ROLES, ...HEAD_ROLES];

// Whether a role has access to the School Visit screen at all (applicants + the
// Admin approver).
export const canUseSchoolVisit = (role) =>
  SCHOOL_VISIT_APPLICANT_ROLES.includes(role) || role === 'creator_admin';

// Meeting Corner: who can POST a link (leaders, heads, CEO, Admin) vs who can
// VIEW the corner (everyone except chairman).
export const MEETING_CREATOR_ROLES = [...LEADER_ROLES, ...HEAD_ROLES, ...ADMIN_ROLES];
export const MEETING_VIEWER_ROLES = ['trainer', ...MEETING_CREATOR_ROLES];
export const canPostMeeting = (role) => MEETING_CREATOR_ROLES.includes(role);
export const canUseMeetings = (role) => MEETING_VIEWER_ROLES.includes(role);

// The browser portal is an oversight console: the Admin, the CEO and school
// chairmen — the three logins whose work is reviewing and approving, which is
// genuinely better on a big screen.
//
// IECE field staff (trainers, team leaders, heads) are deliberately excluded.
// Their day is face check-in/check-out and GPS geofencing, which only the phone
// can do honestly, so letting them reach a browser build would offer a portal
// that cannot perform their core task. They are told to use the mobile app.
export const WEB_ALLOWED_ROLES = ['creator_admin', 'ceo', 'chairman'];
export const canUseWeb = (role) => WEB_ALLOWED_ROLES.includes(role);

export const isHead = (role) => HEAD_ROLES.includes(role);
export const isLeader = (role) => LEADER_ROLES.includes(role);

// Human-friendly labels for every role (used in dropdowns, headers, cards).
export const ROLE_LABELS = {
  creator_admin: 'Admin',
  ceo: 'CEO',
  chairman: 'Chairman',
  team_leader: 'Team Leader',
  trainee_team_leader: 'Trainee Team Leader',
  trainer: 'Trainer',
  zonal_head: 'Zonal Head',
  cluster_head: 'Cluster Head',
  regional_head: 'Regional Head',
};

export const roleLabel = (role) =>
  ROLE_LABELS[role] || (role ? role.replace(/_/g, ' ') : '');
