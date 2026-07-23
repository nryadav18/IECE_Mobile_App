const Notification = require('../models/Notification');
const { sendPushNotification } = require('./pushNotification');

// Lazy require to avoid any load-order coupling.
const getUserModel = () => require('../models/User');

/**
 * Persist an in-app notification for each recipient AND fire a live push to
 * their devices. This is the single entry point the app should use so an
 * inbox record and a push always stay in lock-step.
 *
 * Recipients are de-duplicated (a user in several overlapping groups — e.g. a
 * head who is also CEO's direct contact — only gets one notification).
 *
 * @param {Array<string|ObjectId|{_id}>} recipients - user ids or docs
 * @param {object} payload
 * @param {string} payload.type   machine category (drives tap routing)
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {object} [payload.data] deep-link payload (e.g. { requestId })
 * @returns {Promise<{created:number, pushed:number}>}
 */
const notify = async (recipients, { type, title, body = '', data = {} }) => {
  const ids = [...new Set(
    (Array.isArray(recipients) ? recipients : [recipients])
      .map((r) => (r && r._id ? r._id : r))
      .filter(Boolean)
      .map((id) => String(id))
  )];

  if (ids.length === 0) return { created: 0, pushed: 0 };

  // 1. Persist one inbox document per recipient.
  let created = 0;
  try {
    const docs = ids.map((recipient) => ({ recipient, type, title, body, data }));
    const inserted = await Notification.insertMany(docs, { ordered: false });
    created = inserted.length;
  } catch (err) {
    // insertMany is best-effort; a single bad doc must not lose the others or
    // block the push. Log and carry on.
    console.error('notify: failed to persist some notifications:', err.message);
  }

  // 2. Fire a live push to whoever has a registered device token.
  let pushed = 0;
  try {
    const User = getUserModel();
    const users = await User.find({
      _id: { $in: ids },
      expoPushToken: { $ne: null }
    }).select('expoPushToken');
    const tokens = users.map((u) => u.expoPushToken).filter(Boolean);
    if (tokens.length > 0) {
      // The push data payload must be flat/string-coercible; nest the id under a
      // stable key so the client can deep-link on tap.
      const res = await sendPushNotification(tokens, title, body, { type, ...data });
      pushed = res.successCount || 0;
    }
  } catch (err) {
    console.error('notify: push delivery failed:', err.message);
  }

  return { created, pushed };
};

module.exports = { notify };
