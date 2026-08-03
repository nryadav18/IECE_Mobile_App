const mongoose = require('mongoose');

/**
 * An admin's override of the app's celebration calendar.
 *
 * The catalogue of ~40 occasions ships *inside* the app
 * (`frontend/src/celebrations/occasions.js`), so the home screen header is
 * correct offline, on a cold start, on first paint. This collection exists
 * only to change that catalogue without shipping a build. It holds
 * exceptions, never the whole calendar — an empty collection is the normal,
 * healthy state.
 *
 * Three things a document here can do, distinguished by which fields are set:
 *
 *   · **mute** — `{ key: 'holi', muted: true }` stops a bundled occasion from
 *     taking over the header.
 *   · **correct** — `{ key: 'diwali', date: '2027-10-30' }` fixes one year's
 *     date. Regional panchangams routinely differ by a day, and moon-sighting
 *     decides the Islamic dates locally, so this is expected traffic rather
 *     than a sign something went wrong.
 *   · **add** — a `key` the app has never heard of, plus a `date` (one-off) or
 *     `recurring` (every year), creates an occasion outright. A Founder's Day,
 *     a school's centenary, an award night.
 *
 * Deliberately NOT named Holiday, and deliberately not mounted under
 * `/api/holidays`: `SchoolHoliday` is a completely different feature — a
 * per-school, request-and-approve workflow that blocks attendance. These two
 * must never be confused for one another.
 */
const OccasionSchema = new mongoose.Schema(
  {
    // Matches a bundled occasion's key to override it, or introduces a new one.
    key: {
      type: String,
      required: [true, 'An occasion key is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },

    name: { type: String, trim: true },
    wish: { type: String, trim: true },
    subtitle: { type: String, trim: true },

    // The IST calendar day, as a plain string. Stored this way — rather than as
    // a Date — for the same reason SchoolHoliday does it: a Date would be
    // stored in UTC and drift a day either side for anyone whose device or
    // server sits in a different offset. A calendar day is not an instant.
    date: {
      type: String,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'],
      default: null,
    },

    // For an occasion that recurs on the same date every year. Month is
    // 0-indexed, matching the JS Date API and the app-side catalogue.
    recurring: {
      month: { type: Number, min: 0, max: 11, default: null },
      day: { type: Number, min: 1, max: 31, default: null },
    },

    // Presentation. Any field left unset falls back to the bundled occasion's
    // value, so a partial override can't blank a palette or a wish.
    scene: { type: String, trim: true, default: null },
    palette: { type: [String], default: undefined },
    field: { type: String, trim: true, default: null },
    accent: { type: String, trim: true, default: null },
    ink: { type: String, enum: ['light', 'dark', null], default: null },
    emblem: { type: String, trim: true, default: null },
    particles: { type: String, trim: true, default: null },

    // Who or what the day is about, shown small under the subtitle.
    person: { type: String, trim: true, default: null },
    priority: { type: Number, default: null },
    tags: { type: [String], default: undefined },

    muted: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// The home screen reads this collection on every cold start, so keep the
// lookup trivial. `key` is already unique-indexed; this covers the "what falls
// on this date" query the notification job runs.
OccasionSchema.index({ date: 1 });

module.exports = mongoose.model('Occasion', OccasionSchema);
