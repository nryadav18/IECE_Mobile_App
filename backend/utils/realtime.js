const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ADMIN_ROLES } = require('./roles');

// ---------------------------------------------------------------------------
// Realtime (socket.io) layer.
//
// Today this drives exactly one thing: the Admin/CEO live Monitoring dashboard.
// The design deliberately avoids the naive "recompute and broadcast on every
// mutation" approach, which would run the whole dashboard aggregation once per
// check-in, per approval, per upload — including at times when nobody is
// watching the screen at all.
//
// Instead:
//   * mutations only set a dirty flag (markMonitoringDirty), which is O(1);
//   * a single 1-second ticker recomputes AND pushes, but only while at least
//     one admin/CEO socket is in the room AND something actually changed;
//   * a slower forced refresh catches changes this process cannot observe —
//     cron jobs, a second server instance, direct DB edits, and the IST
//     midnight rollover.
//
// So the screen is genuinely push-driven at 1-second granularity, while the
// database sees at most one aggregation per second and none at all when the
// dashboard is closed.
// ---------------------------------------------------------------------------

const MONITORING_ROOM = 'monitoring';

// How often the ticker looks for work. The dashboard's contract is "updated
// every second", so this is 1000ms — but a tick with no dirty flag does no
// database work whatsoever.
const TICK_MS = 1000;

// Even with nothing marked dirty, re-push this often. Covers cron-written data,
// multi-instance deployments, and the moment the IST day rolls over.
const FORCED_REFRESH_MS = 30000;

let io = null;
let dirty = false;
let lastPushAt = 0;
let ticker = null;
let building = false;
// Serialised form of the last snapshot sent (minus its timestamp). A snapshot is
// only worth pushing if it actually differs — plenty of writes that mark the
// dashboard dirty (an inbox read, a profile edit) change nothing it renders, and
// re-sending an identical payload every second would be pure waste on mobile
// data. When it matches, a heartbeat goes out instead so the screen's freshness
// label stays honest for a few bytes.
let lastSignature = null;

// Injected by the monitoring controller to avoid a require cycle
// (controller -> realtime -> controller).
let snapshotBuilder = null;

/** The controller registers its snapshot builder here at require time. */
function registerSnapshotBuilder(fn) {
  snapshotBuilder = fn;
}

/**
 * Attach socket.io to the HTTP server.
 *
 * Auth is per-connection: the client hands over the same JWT the REST API uses,
 * and it is verified with the same rules — including tokenVersion, so a socket
 * cannot outlive a "logged in on another device" invalidation.
 */
function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // Mobile networks drop long-lived upgrades often; allow the polling
    // fallback so the dashboard keeps streaming rather than going dead.
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '');
      if (!token) return next(new Error('unauthorized'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('name role tokenVersion');
      if (!user) return next(new Error('unauthorized'));

      const currentVersion = user.tokenVersion || 0;
      if ((decoded.tokenVersion || 0) !== currentVersion) return next(new Error('session expired'));

      socket.user = { id: String(user._id), name: user.name, role: user.role };
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('monitoring:join', async () => {
      // Only the Admin and the CEO may watch the org-wide dashboard — the same
      // rule the REST route enforces. Checked here too: joining a room is not
      // covered by the route's `authorize`.
      if (!ADMIN_ROLES.includes(socket.user.role)) {
        socket.emit('monitoring:error', { message: 'Not authorized' });
        return;
      }
      socket.join(MONITORING_ROOM);
      // Send the joiner a snapshot immediately so the screen paints without
      // waiting for the next change.
      const snap = await buildSnapshot();
      if (snap) {
        socket.emit('monitoring:snapshot', snap);
        // This counts as the room being brought current. Without it the very
        // next tick would see lastPushAt in the distant past, judge the room
        // stale, and re-push a snapshot the client already has.
        lastPushAt = Date.now();
        lastSignature = signatureOf(snap);
      }
      startTicker();
    });

    socket.on('monitoring:leave', () => {
      socket.leave(MONITORING_ROOM);
      stopTickerIfIdle();
    });

    socket.on('disconnect', () => {
      stopTickerIfIdle();
    });
  });

  startTickerGuard();
  return io;
}

/** Number of sockets currently watching the dashboard. */
function watcherCount() {
  if (!io) return 0;
  const room = io.sockets.adapter.rooms.get(MONITORING_ROOM);
  return room ? room.size : 0;
}

/**
 * Flag that something the dashboard shows has changed.
 *
 * Intentionally cheap — no queries, no payload. The ticker decides whether that
 * change is worth turning into a push.
 */
function markMonitoringDirty() {
  dirty = true;
}

async function buildSnapshot() {
  if (!snapshotBuilder) return null;
  try {
    return await snapshotBuilder();
  } catch (err) {
    console.error('monitoring snapshot build failed:', err.message);
    return null;
  }
}

/** Everything about a snapshot except when it was generated. */
function signatureOf(snap) {
  const { generatedAt, ...rest } = snap;
  return JSON.stringify(rest);
}

async function tick() {
  if (building) return;                  // a slow build must never stack up
  if (watcherCount() === 0) return;

  const stale = Date.now() - lastPushAt >= FORCED_REFRESH_MS;
  if (!dirty && !stale) return;

  building = true;
  dirty = false;
  try {
    const snap = await buildSnapshot();
    if (!snap || watcherCount() === 0) return;

    const sig = signatureOf(snap);
    if (sig === lastSignature) {
      // Nothing the dashboard shows has moved. Tell the client it is still
      // current rather than re-sending a payload it already has.
      io.to(MONITORING_ROOM).emit('monitoring:heartbeat', { at: snap.generatedAt });
    } else {
      io.to(MONITORING_ROOM).emit('monitoring:snapshot', snap);
      lastSignature = sig;
    }
    lastPushAt = Date.now();
  } finally {
    building = false;
  }
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, TICK_MS);
  if (ticker.unref) ticker.unref();
}

function stopTickerIfIdle() {
  if (ticker && watcherCount() === 0) {
    clearInterval(ticker);
    ticker = null;
  }
}

// A socket can join before the ticker exists in edge cases (server restart with
// clients already connected); this makes sure one always comes back up.
function startTickerGuard() {
  const guard = setInterval(() => {
    if (watcherCount() > 0) startTicker();
    else stopTickerIfIdle();
  }, 10000);
  if (guard.unref) guard.unref();
}

module.exports = {
  initRealtime,
  markMonitoringDirty,
  registerSnapshotBuilder,
  watcherCount,
  MONITORING_ROOM,
};
