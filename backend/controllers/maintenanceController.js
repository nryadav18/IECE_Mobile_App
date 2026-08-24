const AppMaintenance = require('../models/AppMaintenance');
const { istToUtcMs, formatIst } = require('../utils/istClock');

/**
 * "Is the app under maintenance right now?"
 *
 * Asked at every launch, on every return from the background, and repeatedly
 * while the maintenance screen is up. Read-only: there is no endpoint here that
 * can turn maintenance on, because the switch lives in the database and is set
 * by hand (see models/AppMaintenance.js for why).
 *
 * ── The server owns the clock ─────────────────────────────────────────────
 *
 * The window is defined in IST wall-clock time, and it is compared against the
 * SERVER's clock, not the phone's. The phone is told how many seconds are left
 * rather than when the window ends, so it counts down from a number instead of
 * subtracting two dates of its own.
 *
 * That is not fussiness. A device with a wrong date is common — a flat battery,
 * a manual timezone change, a factory-reset tablet — and if the phone did the
 * comparison, one of those devices would either walk straight into an app being
 * migrated, or sit locked out of a working app with a countdown that never
 * reaches zero. Neither is diagnosable by the person holding it.
 *
 * ── It is public, like the update gate ───────────────────────────────────
 *
 * No `protect`. The gate has to be able to appear on the login screen: during a
 * deployment, signing in is exactly the thing that will not work.
 *
 * ── It fails open ────────────────────────────────────────────────────────
 *
 * No document, a malformed one, a thrown error, no database — every one of them
 * answers "not under maintenance". This screen blocks every user of every store
 * build simultaneously, so a fault must never be able to raise it; a block is
 * only ever raised on a positive, verified answer. The phone keeps its own
 * cached copy of the last real answer, which is what covers the case this would
 * otherwise miss: the backend being unreachable *because* of the deployment.
 */

/** The one response shape, so the client never has to special-case anything. */
const OPEN = {
  success: true,
  data: {
    active: false,
    secondsRemaining: null,
    endsAtLabel: null,
    title: null,
    message: null,
  },
};

/**
 * @desc    Is the app under maintenance?
 * @route   GET /api/maintenance
 * @access  Public
 */
exports.getMaintenance = async (req, res) => {
  try {
    // BY KEY, never findOne({}). A collection edited by hand collects strays,
    // and "whichever document the index returns first" is not something that
    // should be able to lock the company out.
    const doc = await AppMaintenance.findOne({ key: 'global' }).lean();

    if (!doc || !doc.enabled) return res.json(OPEN);

    const endsAtMs = istToUtcMs(doc.date, doc.time);
    const now = Date.now();

    // A complete window that has already ended lifts the block on its own, so
    // an overrun deployment does not depend on somebody remembering to go back
    // and flip the boolean.
    if (endsAtMs !== null && endsAtMs <= now) return res.json(OPEN);

    // No usable end time: blocked, with no countdown to show. The half-filled
    // document blocks rather than opens — see the model for the reasoning.
    const secondsRemaining =
      endsAtMs === null ? null : Math.max(0, Math.ceil((endsAtMs - now) / 1000));

    res.json({
      success: true,
      data: {
        active: true,
        secondsRemaining,
        // Formatted server-side: the window is IST wherever the phone is.
        endsAtLabel: formatIst(endsAtMs),
        title: (doc.title || '').trim() || null,
        message: (doc.message || '').trim() || null,
      },
    });
  } catch (err) {
    console.error('getMaintenance:', err.message);
    // Silence is the safe answer. See the note above.
    res.json(OPEN);
  }
};
