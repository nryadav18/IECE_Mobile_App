const Occasion = require('../models/Occasion');
const { trail } = require('../utils/approvalTrail');
const { trackChanges } = require('../utils/changeSummary');

/**
 * Celebration-calendar overrides.
 *
 * Reads are open to every authenticated role — the home screen header needs
 * them whoever is looking at it, exactly like `GET /api/stats/overview`.
 * Writes are `creator_admin` only, following the convention in `adminRoutes`
 * (CEO reads, creator_admin writes).
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * @desc    Every override, for the app to fold into its bundled catalogue
 * @route   GET /api/occasions
 * @access  Private (any authenticated role)
 */
exports.listOccasions = async (req, res) => {
  try {
    const occasions = await Occasion.find()
      .select('-createdBy -__v')
      .sort({ key: 1 })
      .lean();
    res.json({ success: true, data: occasions });
  } catch (err) {
    console.error('listOccasions:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the celebration calendar.' });
  }
};

/**
 * @desc    Create or update one override, keyed by `key`
 * @route   POST /api/occasions
 * @access  Private (creator_admin)
 */
exports.upsertOccasion = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim().toLowerCase();
    if (!key) {
      return res.status(400).json({ success: false, message: 'An occasion key is required.' });
    }

    const {
      name, wish, subtitle, person, date, recurring, scene, palette,
      field, accent, ink, emblem, particles, priority, tags, muted,
    } = req.body;

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'date must be in YYYY-MM-DD form.' });
    }

    // Colours end up in a style prop on every phone, so validate rather than
    // trust: a malformed string here would be an invalid colour on the header.
    if (palette !== undefined) {
      if (!Array.isArray(palette) || palette.length === 0 || !palette.every((c) => HEX.test(c))) {
        return res.status(400).json({
          success: false,
          message: 'palette must be a non-empty array of #RRGGBB colours.',
        });
      }
    }
    for (const [label, value] of [['field', field], ['accent', accent]]) {
      if (value && !HEX.test(value)) {
        return res.status(400).json({ success: false, message: `${label} must be a #RRGGBB colour.` });
      }
    }

    // Only fields the caller actually sent are written, so a partial update
    // can't wipe the rest of an existing override.
    const update = {};
    const assign = (k, v) => {
      if (v !== undefined) update[k] = v;
    };
    assign('name', name);
    assign('wish', wish);
    assign('subtitle', subtitle);
    assign('person', person);
    assign('date', date);
    assign('scene', scene);
    assign('palette', palette);
    assign('field', field);
    assign('accent', accent);
    assign('ink', ink);
    assign('emblem', emblem);
    assign('particles', particles);
    assign('tags', tags);
    if (priority !== undefined) update.priority = Number(priority);
    if (muted !== undefined) update.muted = !!muted;
    if (recurring && Number.isInteger(recurring.month) && Number.isInteger(recurring.day)) {
      update.recurring = { month: recurring.month, day: recurring.day };
    }

    // Read first so an upsert can tell the log which of its two jobs it did.
    // "Diwali created" and "Diwali edited" are different events and a single
    // "saved" row would collapse them into one.
    const previous = await Occasion.findOne({ key }).lean();

    const occasion = await Occasion.findOneAndUpdate(
      { key },
      { $set: update, $setOnInsert: { key, createdBy: req.user._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ success: true, data: occasion });

    if (!previous) {
      trail({
        entityType: 'occasion',
        entityId: occasion._id,
        entityLabel: `Celebration · ${occasion.name || occasion.key}`,
        actor: req.user,
        action: 'created',
        note: `Override added for "${key}".`,
      });
    } else {
      const changes = trackChanges()
        .field('name', previous.name, occasion.name)
        .field('wish', previous.wish, occasion.wish)
        .field('subtitle', previous.subtitle, occasion.subtitle)
        .field('person', previous.person, occasion.person)
        .field('date', previous.date, occasion.date)
        .field('scene', previous.scene, occasion.scene)
        .field('emblem', previous.emblem, occasion.emblem)
        .field('priority', previous.priority, occasion.priority)
        .field('muted', !!previous.muted, !!occasion.muted)
        .count('palette colours', previous.palette, occasion.palette)
        .count('tags', previous.tags, occasion.tags);

      if (changes.changed) {
        trail({
          entityType: 'occasion',
          entityId: occasion._id,
          entityLabel: `Celebration · ${occasion.name || occasion.key}`,
          actor: req.user,
          action: 'updated',
          note: changes.summary(),
        });
      }
    }
  } catch (err) {
    console.error('upsertOccasion:', err.message);
    res.status(500).json({ success: false, message: 'Could not save that occasion.' });
  }
};

/**
 * @desc    Drop an override — the bundled occasion goes back to its defaults
 * @route   DELETE /api/occasions/:key
 * @access  Private (creator_admin)
 */
exports.deleteOccasion = async (req, res) => {
  try {
    const key = String(req.params.key || '').trim().toLowerCase();
    const removed = await Occasion.findOneAndDelete({ key });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'No override exists for that occasion.' });
    }
    res.json({ success: true, message: 'Override removed.' });

    trail({
      entityType: 'occasion',
      entityId: removed._id,
      entityLabel: `Celebration · ${removed.name || removed.key}`,
      actor: req.user,
      action: 'deleted',
      note: `Override removed — "${key}" is back to its bundled defaults.`,
    });
  } catch (err) {
    console.error('deleteOccasion:', err.message);
    res.status(500).json({ success: false, message: 'Could not remove that override.' });
  }
};
