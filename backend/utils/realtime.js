const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { monitoringScopeFor } = require('./monitoringScope');

// ---------------------------------------------------------------------------
// Realtime (socket.io) layer.
//
// Today this drives exactly one thing: the live Monitoring dashboard.
// The design deliberately avoids the naive "recompute and broadcast on every
// mutation" approach, which would run the whole dashboard aggregation once per
// check-in, per approval, per upload — including at times when nobody is
// watching the screen at all.
//
// Instead:
//   * mutations only set a dirty flag (markMonitoringDirty), which is O(1);
//   * a single 1-second ticker recomputes AND pushes, but only while at least
//     one socket is watching AND something actually changed;
//   * a slower forced refresh catches changes this process cannot observe —
//     cron jobs, a second server instance, direct DB edits, and the IST
//     midnight rollover.
//
// So the screen is genuinely push-driven at 1-second granularity, while the
// database sees at most one aggregation per second and none at all when the
// dashboard is closed.
//
// One further wrinkle: the dashboard is no longer one dataset. The Admin sees
// the organisation, a head sees their teams, a team leader sees their trainers.
// Rather than aggregating once per WATCHER, the ticker aggregates the
// organisation once and then projects it once per distinct AUDIENCE (see
// monitoringController.project). Sockets are grouped into a room per scope key,
// so ten leaders of the same team cost one projection, and a viewer's frame
// never contains a person outside their scope in the first place.
// ---------------------------------------------------------------------------

const MONITORING_ROOM = 'monitoring';

// How often the ticker looks for work. The dashboard's contract is "updated
// every second", so this is 1000ms — but a tick with no dirty flag does no
// database work whatsoever.
const TICK_MS = 1000;

// Even with nothing marked dirty, re-push this often. Covers cron-written data,
// multi-instance deployments, and the moment the IST day rolls over.
const FORCED_REFRESH_MS = 30000;

// A joining socket is served straight away rather than waiting for the next
// tick. When several dashboards open at once — or a phone reconnects mid-tick —
// they can share one organisation build instead of each triggering their own.
const BASE_CACHE_MS = 900;

let io = null;
let dirty = false;
let lastPushAt = 0;
let ticker = null;
let building = false;
let cachedBase = null;
let cachedBaseAt = 0;

// Serialised form of the last snapshot sent TO EACH AUDIENCE (minus its
// timestamp), keyed by scope key. A snapshot is only worth pushing if it
// actually differs — plenty of writes that mark the dashboard dirty (an inbox
// read, a profile edit) change nothing it renders, and re-sending an identical
// payload every second would be pure waste on mobile data. When it matches, a
// heartbeat goes out instead so the screen's freshness label stays honest for a
// few bytes.
//
// Kept per audience rather than globally: a check-in inside one team must not
// stop a different team's dashboard from being told it is still current, and
// must not be mistaken for a change by a scope that cannot even see that person.
const lastSignatures = new Map();

// Injected by the monitoring controller to avoid a require cycle
// (controller -> realtime -> controller).
let baseBuilder = null;
let projector = null;

/**
 * The controller registers its two halves here at require time: `build` runs
 * the queries for a day, `project` narrows the result to one audience.
 */
function registerSnapshotBuilder(build, project) {
  baseBuilder = build;
  projector = project;
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
      // teamId/teamIds come along because they are what a viewer's scope is
      // derived from — resolved here, from the database, so a client can never
      // widen its own view by claiming a role or a team it does not have.
      const user = await User.findById(decoded.id).select('name role tokenVersion teamId teamIds');
      if (!user) return next(new Error('unauthorized'));

      const currentVersion = user.tokenVersion || 0;
      if ((decoded.tokenVersion || 0) !== currentVersion) return next(new Error('session expired'));

      socket.user = {
        _id: user._id,
        id: String(user._id),
        name: user.name,
        role: user.role,
        teamId: user.teamId,
        teamIds: user.teamIds,
      };
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('monitoring:join', async () => {
      // What this viewer is entitled to see — the same call the REST route
      // makes. Checked here too: joining a room is not covered by the route's
      // `authorize`, and here the scope decides the DATA, not just the door.
      const scope = monitoringScopeFor(socket.user);
      if (!scope) {
        socket.emit('monitoring:error', { message: 'Not authorized' });
        return;
      }
      socket.data.monitoringScope = scope;
      socket.join(MONITORING_ROOM);
      socket.join(scopeRoom(scope.key));

      // Send the joiner a snapshot immediately so the screen paints without
      // waiting for the next change.
      const base = await getBase();
      const snap = base && projectFor(base, scope);
      if (snap) {
        socket.emit('monitoring:snapshot', snap);
        // This counts as the audience being brought current. Without it the
        // very next tick would see lastPushAt in the distant past, judge the
        // room stale, and re-push a snapshot the client already has.
        lastPushAt = Date.now();
        lastSignatures.set(scope.key, signatureOf(snap));
      }
      startTicker();
    });

    socket.on('monitoring:leave', () => {
      const scope = socket.data.monitoringScope;
      socket.leave(MONITORING_ROOM);
      if (scope) socket.leave(scopeRoom(scope.key));
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

/** The socket.io room holding every watcher of one audience. */
const scopeRoom = (key) => `${MONITORING_ROOM}:${key}`;

/**
 * Today's organisation, freshly built or reused while it is still warm.
 *
 * The cache exists for JOINERS, not for the ticker: a tick always wants current
 * data and passes `force`.
 */
async function getBase(force = false) {
  if (!baseBuilder) return null;
  if (!force && cachedBase && Date.now() - cachedBaseAt < BASE_CACHE_MS) return cachedBase;
  try {
    const built = await baseBuilder();
    cachedBase = built;
    cachedBaseAt = Date.now();
    return built;
  } catch (err) {
    console.error('monitoring snapshot build failed:', err.message);
    return null;
  }
}

/** One audience's payload, or null if the projection blew up. */
function projectFor(base, scope) {
  try {
    return projector(base, scope);
  } catch (err) {
    console.error('monitoring projection failed:', err.message);
    return null;
  }
}

/**
 * The distinct audiences currently watching, keyed by scope key.
 *
 * Several sockets usually collapse into one entry — every Admin and CEO shares
 * the 'org' key, and a head's phone and laptop share theirs — which is what
 * keeps the per-tick cost proportional to the number of DIFFERENT views rather
 * than to the number of connections.
 */
function activeScopes() {
  const scopes = new Map();
  if (!io) return scopes;
  const room = io.sockets.adapter.rooms.get(MONITORING_ROOM);
  if (!room) return scopes;
  room.forEach((socketId) => {
    const scope = io.sockets.sockets.get(socketId)?.data?.monitoringScope;
    if (scope && !scopes.has(scope.key)) scopes.set(scope.key, scope);
  });
  return scopes;
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
    const scopes = activeScopes();
    if (scopes.size === 0) return;

    // The organisation is aggregated ONCE, however many audiences are watching.
    const base = await getBase(true);
    if (!base) return;

    scopes.forEach((scope, key) => {
      // Somebody may have closed the screen while the build was running.
      if (!io.sockets.adapter.rooms.get(scopeRoom(key))) return;
      const snap = projectFor(base, scope);
      if (!snap) return;

      const sig = signatureOf(snap);
      if (sig === lastSignatures.get(key)) {
        // Nothing THIS audience can see has moved. Tell them they are still
        // current rather than re-sending a payload they already have.
        io.to(scopeRoom(key)).emit('monitoring:heartbeat', { at: snap.generatedAt });
      } else {
        io.to(scopeRoom(key)).emit('monitoring:snapshot', snap);
        lastSignatures.set(key, sig);
      }
    });

    // Audiences that have all gone home leave nothing behind — otherwise the
    // map grows for the life of the process, one entry per person who ever
    // opened the screen.
    lastSignatures.forEach((_, key) => { if (!scopes.has(key)) lastSignatures.delete(key); });

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
    // Nobody is watching: forget what each audience last saw, so the next
    // person to open the screen is sent a snapshot rather than a heartbeat
    // about a payload they never received.
    lastSignatures.clear();
    cachedBase = null;
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
