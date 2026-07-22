// Central role groupings for the client, mirroring backend/utils/roles.js so
// role handling stays consistent instead of scattering role strings around.

export const HEAD_ROLES = ['zonal_head', 'cluster_head', 'regional_head'];
export const LEADER_ROLES = ['team_leader', 'trainee_team_leader'];
export const TEAM_MEMBER_ROLES = ['team_leader', 'trainee_team_leader', 'trainer'];
// Top-level oversight logins. CEO is a read-only super-viewer; admin has full control.
export const ADMIN_ROLES = ['creator_admin', 'ceo'];
// Everyone a visit report can be logged on (all field staff).
export const REPORT_TARGET_ROLES = ['team_leader', 'trainee_team_leader', 'trainer', 'zonal_head', 'cluster_head', 'regional_head'];

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
