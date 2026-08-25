// ---------------------------------------------------------------------------
// SAYING WHAT HAPPENED TO A FILE, IN WORDS SOMEONE CAN ACT ON.
//
// These were written for the Cloudinary deletion path and are kept verbatim
// because the distinction they draw is the valuable part and has nothing to do
// with which cloud is underneath:
//
//   a file that is gone and a file that was never there are BOTH success —
//   the goal is the end state, not the act;
//
//   "deleted" and "PROVEN deleted" are different claims, and a log that cannot
//   tell them apart is a log that will eventually lie.
//
// Every screen that reports a deletion reads these, so the wording is identical
// everywhere and never mentions a storage provider — which is what let the app
// switch clouds without a single user-facing string changing.
// ---------------------------------------------------------------------------

/**
 * A one-line summary for an API response or a log.
 *
 * Says "verified" only where the object was looked up again and answered 404,
 * so a reader can tell proof from a report. `{ short: true }` drops the caveat
 * for places that only have room for the headline.
 */
function purgeSummary(report, { short = false } = {}) {
  if (!report || report.requested === 0) return 'Nothing to remove from the cloud.';
  const bits = [];
  if (report.deleted) bits.push(`${report.deleted} deleted`);
  if (report.missing) bits.push(`${report.missing} already gone`);
  if (report.failed) bits.push(`${report.failed} could not be removed`);
  let line = `Cloud storage: ${bits.join(', ')}.`;
  if (!short && report.unverified) {
    line += ` ${report.unverified} not verified (storage could not be re-checked).`;
  } else if (!short && report.verified && !report.failed) {
    line += ' Verified gone from the cloud.';
  }
  return line;
}

/**
 * Why a purge failed, in words the person reading them can act on.
 *
 * Returns null when nothing failed.
 */
function purgeProblem(report) {
  if (!report || report.ok) return null;
  if (report.blocked) {
    return 'Cloud storage is currently refusing all requests'
      + (report.blockedReason ? ` (${report.blockedReason})` : '')
      + '. This usually means the access credentials have been revoked or rescoped '
      + '— it is also why images and videos may not be loading. Nothing can be '
      + 'deleted until access is restored.';
  }
  if (report.stillPresent) {
    return `${report.stillPresent} file(s) are still in cloud storage even though the delete `
      + 'was accepted. They have been kept on the record so they can be removed later — '
      + 'please report this, it means the deletion is not doing what it says.';
  }
  return `${report.failed} file(s) could not be removed from cloud storage. Please try again.`;
}

module.exports = { purgeSummary, purgeProblem };
