const { getMessaging } = require('firebase-admin/messaging');
const { initFirebase, isFirebaseAvailable } = require('./firebase');

// Initialize the Admin SDK on first load.
initFirebase();

/**
 * Send a native push notification to one or more FCM device tokens via the
 * Firebase Admin SDK.
 * @param {string|string[]} to - FCM device token(s)
 * @param {string} title
 * @param {string} body
 * @param {object} data - Extra payload (optional). FCM requires string values.
 * @returns {Promise<{successCount:number, failureCount:number}>}
 */
const sendPushNotification = async (to, title, body, data = {}) => {
  if (!isFirebaseAvailable()) {
    console.error('Push skipped: Firebase Admin is not initialized.');
    return { successCount: 0, failureCount: 0 };
  }

  const tokens = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (tokens.length === 0) return { successCount: 0, failureCount: 0 };

  // FCM data payload values must all be strings.
  const stringData = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) stringData[k] = String(v);
  });

  const message = {
    tokens,
    notification: { title, body },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'default',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: { sound: 'default', badge: 1 },
      },
    },
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);

    const errors = [];
    response.responses.forEach((res, i) => {
      if (res.success) {
        console.log(`Push delivered to ${tokens[i]} (id: ${res.messageId})`);
      } else {
        const detail = { code: res.error?.code, message: res.error?.message };
        errors.push(detail);
        console.error(`Push failed for ${tokens[i]}: ${detail.code} - ${detail.message}`);
      }
    });

    return { successCount: response.successCount, failureCount: response.failureCount, errors };
  } catch (err) {
    console.error('Push notification error:', err.message);
    return { successCount: 0, failureCount: 0, errors: [{ code: 'exception', message: err.message }] };
  }
};

// Friendly, role-aware copy so the welcome feels tailored to the IECE app.
const ROLE_GREETINGS = {
  creator_admin: "Everything's running smoothly across IECE. Tap to open your control center. ⚡",
  trainer: "Your trainer portal is ready — let's make today impactful! 🚀",
  chairman: "Your chairman dashboard awaits. Lead the way today! 🌟",
  team_leader: "Your team is counting on you. Time to lead with IECE! 💪",
};

/**
 * Send a warm, personalized welcome push the moment a user signs in.
 * Falls back gracefully when the user has no registered push token.
 * @param {object} user - Mongoose user doc (needs name, role, expoPushToken)
 */
const sendWelcomeNotification = async (user) => {
  if (!user || !user.expoPushToken) return;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
  const body = ROLE_GREETINGS[user.role] || 'Great to see you again. Tap to jump back in! 🎉';

  await sendPushNotification(
    user.expoPushToken,
    `👋 Welcome back, ${firstName}!`,
    body,
    { type: 'welcome' }
  );
};

// Lazy require to avoid any load-order coupling (User does not require this file).
const getUserModel = () => require('../models/User');

/**
 * Notify a single user (Mongoose doc) if they have a registered push token.
 */
const notifyUser = async (user, title, body, data = {}) => {
  if (user && user.expoPushToken) {
    return sendPushNotification(user.expoPushToken, title, body, data);
  }
  return { successCount: 0, failureCount: 0, errors: [] };
};

/**
 * Notify a user by id (fetches the token).
 */
const notifyUserById = async (userId, title, body, data = {}) => {
  if (!userId) return { successCount: 0, failureCount: 0, errors: [] };
  const User = getUserModel();
  const user = await User.findById(userId).select('expoPushToken');
  return notifyUser(user, title, body, data);
};

/**
 * Notify every user holding a given role (e.g. all creator_admins) in one send.
 */
const notifyRole = async (role, title, body, data = {}) => {
  const User = getUserModel();
  const users = await User.find({ role, expoPushToken: { $ne: null } }).select('expoPushToken');
  const tokens = users.map(u => u.expoPushToken).filter(Boolean);
  if (tokens.length === 0) return { successCount: 0, failureCount: 0, errors: [] };
  return sendPushNotification(tokens, title, body, data);
};

module.exports = {
  sendPushNotification,
  sendWelcomeNotification,
  notifyUser,
  notifyUserById,
  notifyRole,
};
