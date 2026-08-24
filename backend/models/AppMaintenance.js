const mongoose = require('mongoose');

/**
 * THE MAINTENANCE SWITCH.
 *
 * One document. When it says so, the released mobile apps put an undismissable
 * screen in front of everything and nobody gets in until the scheduled moment
 * passes — which is the point: an app being updated should not be handing users
 * half-migrated data.
 *
 * ── There is no admin screen, and that is deliberate ─────────────────────
 *
 * This is edited by hand, in the database. It is the single most destructive
 * switch in the product — it locks every user out of every store build at once
 * — and it is used a handful of times a year, immediately before a deployment
 * that is already being done by hand. Putting it behind a button in the app
 * would make it something that can be pressed by accident, or by somebody who
 * did not realise what it does.
 *
 * The document to paste into the `appmaintenances` collection:
 *
 *   {
 *     "key": "global",
 *     "enabled": true,
 *     "date": "25-08-2026",
 *     "time": "14:00",
 *     "title": "We'll be right back",
 *     "message": "IECE is being updated with new features."
 *   }
 *
 * To end maintenance early, set `enabled` to false. Nothing else needs touching.
 *
 * ── `key` is pinned to "global" on purpose ───────────────────────────────
 *
 * The controller looks this document up BY KEY, never "the first one it finds".
 * A collection edited by hand accumulates strays — a copy made before an edit,
 * a test row from six months ago — and "first document" is whichever the index
 * happens to return. The unique key means a stray row is inert: it cannot
 * silently take over and lock the company out.
 *
 * ── The window ───────────────────────────────────────────────────────────
 *
 * `date` + `time` are IST wall-clock strings in the format you would write them
 * down: "25-08-2026" and "14:00" (24-hour). They are the moment maintenance
 * ENDS and the app comes back, which is why the phone shows a countdown to it.
 *
 *   enabled false                          -> app open, whatever the date says
 *   enabled true,  end is in the future    -> BLOCKED, counting down
 *   enabled true,  end has passed          -> app open again, automatically
 *   enabled true,  date/time blank or junk -> BLOCKED with no countdown
 *
 * That last line is the one worth stating out loud. A half-filled document
 * blocks rather than opens: the failure people actually make is flipping
 * `enabled` first and meaning to fill in the time in a moment, and the cost of
 * being wrong in that direction is a maintenance screen nobody needed, against
 * users walking into a database mid-migration.
 */

// Written as strings, exactly as a person would type them, because a person is
// what edits this. A Date here would mean pasting an ISO timestamp in UTC and
// doing the +5:30 in your head at the moment you can least afford to.
const appMaintenanceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'global',
      trim: true,
      lowercase: true,
    },

    /** The switch. Nothing happens while this is false. */
    enabled: { type: Boolean, default: false },

    /** IST wall-clock date the app comes back — "DD-MM-YYYY", e.g. "25-08-2026". */
    date: { type: String, default: '' },

    /** IST wall-clock time the app comes back — "HH:mm" 24-hour, e.g. "14:00". */
    time: { type: String, default: '' },

    // Shown on the maintenance screen. Optional: leave them out and the app
    // uses its own wording. They exist so the reason can be changed during an
    // incident without shipping a build through two app stores.
    title: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppMaintenance', appMaintenanceSchema);
