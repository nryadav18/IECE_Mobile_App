const { HEAD_ROLES } = require('./roles');

/**
 * "Anonymous location" staff — heads who belong to no school.
 *
 * Everyone else in the app is anchored: they are assigned to one or more
 * schools, they register their face separately at each, and every check-in is
 * measured against that school's anchor. A zonal / cluster / regional head can
 * work anywhere on any given day, so for them that model records nothing useful
 * and blocks a great deal. Marking a head "anonymous location" removes the
 * anchor entirely: no school, no geofence, one face registration that stands on
 * its own.
 *
 * Everything else about them is normal. The Admin still approves the face, the
 * calendar still paints their days, leave and substitution still apply.
 *
 * The rule is deliberately checked in ONE place: the flag alone is not enough,
 * the role has to allow it too. That way a stale flag on a user who was later
 * turned into a trainer cannot quietly switch their geofence off.
 */

/** True when this user works with no school and no geofence. */
function isAnonymousStaff(user) {
  return Boolean(user && user.anonymousLocation && HEAD_ROLES.includes(user.role));
}

/** True when this role is allowed to be anonymous at all. */
function canBeAnonymous(role) {
  return HEAD_ROLES.includes(role);
}

/**
 * The single school-less face registration belonging to an anonymous head, or
 * undefined. Found by the ABSENCE of a schoolId — never by string-comparing it,
 * because `String(null)` is 'null' and would match the literal param 'null'.
 */
function findAnonymousRegistration(user) {
  return (user?.faceRegistrations || []).find((fr) => !fr.schoolId);
}

/**
 * The registration for a given school. Kept next to its anonymous twin so the
 * two lookups can never drift apart.
 */
function findSchoolRegistration(user, schoolId) {
  if (!schoolId) return undefined;
  return (user?.faceRegistrations || []).find(
    (fr) => fr.schoolId && String(fr.schoolId) === String(schoolId)
  );
}

/**
 * The `:schoolId` route segment used to address an anonymous registration,
 * which has no id of its own to put in a URL.
 */
const ANONYMOUS_SCHOOL_PARAM = 'anonymous';

/** Does this route param mean "the school-less registration"? */
function isAnonymousParam(value) {
  return value === ANONYMOUS_SCHOOL_PARAM || value === 'null' || value === 'none';
}

module.exports = {
  isAnonymousStaff,
  canBeAnonymous,
  findAnonymousRegistration,
  findSchoolRegistration,
  ANONYMOUS_SCHOOL_PARAM,
  isAnonymousParam,
};
