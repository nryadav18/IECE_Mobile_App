const ApprovalLog = require('../models/ApprovalLog');

/**
 * The two halves of "record who approved this":
 *
 *   decisionOf(actor, action)  -> the snapshot stamped onto the record itself,
 *                                 read back by every card and detail screen.
 *   recordDecision({...})      -> one row in the central Approval Log, which is
 *                                 what the Admin/CEO Approval Log screen reads.
 *
 * They are deliberately separate calls: the snapshot has to be set BEFORE
 * `save()` (it is part of the document), while the log row is written AFTER the
 * HTTP response has gone out, because an audit write must never be the reason a
 * user's approval appears to fail.
 */

/**
 * Build the snapshot to stamp on an approvable record.
 *
 * `actor` is req.user. `action` is what they did — see decisionSchema for the
 * vocabulary. `at` defaults to now but can be passed so the snapshot and the
 * record's own decisionAt/reviewedAt agree to the millisecond.
 */
const decisionOf = (actor, action, at = new Date()) => ({
  userId: actor?._id || actor?.id || null,
  name: actor?.name || null,
  role: actor?.role || null,
  action: action || null,
  at,
});

/**
 * Append one row to the central Approval Log.
 *
 * Never throws and never rejects: it is called after the response, and a failed
 * audit write must not take the process down (see the unhandledRejection note in
 * server.js). A dropped row is logged to the console and nothing else.
 *
 * `subject` / `school` accept either a populated document or a plain id — pass
 * whatever the caller already has in hand rather than fetching for the log.
 */
const recordDecision = async ({
  entityType,
  entityId,
  entityLabel = '',
  subject = null,
  actor = null,
  action,
  note = '',
  school = null,
  at = null,
}) => {
  try {
    if (!entityType || !entityId || !action) return null;

    // Accepts a populated document, a bare ObjectId, or an id string. Checking
    // for `_id` rather than `id` matters: on a raw ObjectId `.id` is the 12-byte
    // buffer, not the hex string, and would be stored as garbage.
    const idOf = (v) => {
      if (!v) return null;
      if (typeof v === 'object' && v._id) return v._id;
      return v;
    };

    return await ApprovalLog.create({
      entityType,
      entityId,
      entityLabel: entityLabel || '',
      subjectId: idOf(subject),
      subjectName: (subject && subject.name) || null,
      subjectRole: (subject && subject.role) || null,
      action,
      actorId: idOf(actor),
      actorName: (actor && actor.name) || 'Unknown',
      actorRole: (actor && actor.role) || null,
      note: note || '',
      schoolId: idOf(school),
      schoolName: (school && school.name) || null,
      decidedAt: at || new Date(),
    });
  } catch (e) {
    console.error('Approval log write failed:', e.message);
    return null;
  }
};

/**
 * Fire-and-forget wrapper. Use this at the end of a controller when the response
 * has already been sent — it keeps the call site to a single line and swallows
 * the promise so it can never surface as an unhandled rejection.
 */
const trail = (payload) => {
  recordDecision(payload).catch((e) => console.error('Approval log error:', e.message));
};

module.exports = { decisionOf, recordDecision, trail };
