const { markMonitoringDirty } = require('../utils/realtime');

// ---------------------------------------------------------------------------
// Marks the live Monitoring dashboard dirty after any successful write.
//
// Written as ONE piece of middleware rather than a `markMonitoringDirty()` call
// sprinkled through twenty controllers, for the same reason approverVisibility
// is: a route added later is covered automatically. A check-in, an approval, a
// new activity, a school edit — every one of them is a non-GET request, so the
// dashboard can never silently miss a change because someone forgot a call.
//
// Setting the flag is O(1) and the ticker in utils/realtime.js does the rest,
// so marking too eagerly costs nothing: with nobody watching, a dirty flag
// never turns into a query.
// ---------------------------------------------------------------------------

// Writes that provably cannot change anything the dashboard renders. Skipped so
// routine background chatter (a phone registering its push token, the inbox
// being marked read) does not force a recompute every few seconds.
const IGNORED = [
  '/api/auth/push-token',
  '/api/notifications/read-all',
  '/api/monitoring',
];

const isIgnored = (url) => IGNORED.some((prefix) => url.startsWith(prefix));

const monitoringInvalidate = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  if (isIgnored(req.originalUrl || req.url || '')) return next();

  res.on('finish', () => {
    // Only a request that actually succeeded changed anything.
    if (res.statusCode >= 200 && res.statusCode < 400) markMonitoringDirty();
  });

  next();
};

module.exports = { monitoringInvalidate };
