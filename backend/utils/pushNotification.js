const { getMessaging } = require('firebase-admin/messaging');
const { initFirebase, isFirebaseAvailable } = require('./firebase');
const { initApns, isApnsAvailable, sendApnsNotification } = require('./apns');

// Initialize both delivery providers on first load.
initFirebase();
initApns();

// Lazy require to avoid any load-order coupling (User does not require this file).
const getUserModel = () => require('../models/User');

/**
 * iOS hands the app a raw APNs device token — a plain hex string with no colon.
 * Android/FCM registration tokens always contain a ':' (e.g. `abc:APA91b...`).
 * We route each token to the provider that can actually deliver it.
 */
const isApnsToken = (token) => /^[0-9a-fA-F]+$/.test(token);

// FCM error codes that mean the token is permanently dead and should be dropped.
const DEAD_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Null out dead push tokens so they stop being retried on every send (which
 * otherwise floods the logs with NotRegistered errors forever).
 */
const pruneDeadTokens = async (deadTokens) => {
  const unique = [...new Set(deadTokens.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const res = await getUserModel().updateMany(
      { expoPushToken: { $in: unique } },
      { $set: { expoPushToken: null } }
    );
    console.log(`Pruned ${res.modifiedCount} dead push token(s).`);
  } catch (err) {
    console.error('Failed to prune dead push tokens:', err.message);
  }
};

/**
 * Send the FCM (Android) share of a token list via the Firebase Admin SDK.
 */
const sendFcmNotification = async (tokens, title, body, data) => {
  if (!isFirebaseAvailable()) {
    console.error('Android push skipped: Firebase Admin is not initialized.');
    return { successCount: 0, failureCount: tokens.length, deadTokens: [] };
  }

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
      notification: { channelId: 'default', sound: 'default' },
    },
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    const deadTokens = [];
    response.responses.forEach((res, i) => {
      if (res.success) {
        console.log(`Push delivered to ${tokens[i]} (id: ${res.messageId})`);
      } else {
        const code = res.error?.code;
        console.error(`Push failed for ${tokens[i]}: ${code} - ${res.error?.message}`);
        if (DEAD_FCM_CODES.has(code)) deadTokens.push(tokens[i]);
      }
    });
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      deadTokens,
    };
  } catch (err) {
    console.error('Push notification error:', err.message);
    return { successCount: 0, failureCount: tokens.length, deadTokens: [] };
  }
};

/**
 * Send a native push notification to one or more device tokens. iOS (APNs) and
 * Android (FCM) tokens may be freely mixed — each is routed to its provider.
 * @param {string|string[]} to - device token(s)
 * @param {string} title
 * @param {string} body
 * @param {object} data - Extra payload (optional). Values are coerced to strings.
 * @returns {Promise<{successCount:number, failureCount:number}>}
 */
const sendPushNotification = async (to, title, body, data = {}) => {
  const tokens = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (tokens.length === 0) return { successCount: 0, failureCount: 0 };

  const apnsTokens = tokens.filter(isApnsToken);
  const fcmTokens = tokens.filter((t) => !isApnsToken(t));

  const results = await Promise.all([
    fcmTokens.length ? sendFcmNotification(fcmTokens, title, body, data) : null,
    apnsTokens.length ? sendApnsNotification(apnsTokens, title, body, data) : null,
  ]);

  let successCount = 0;
  let failureCount = 0;
  const deadTokens = [];
  results.forEach((r) => {
    if (!r) return;
    successCount += r.successCount;
    failureCount += r.failureCount;
    if (r.deadTokens) deadTokens.push(...r.deadTokens);
  });

  await pruneDeadTokens(deadTokens);

  return { successCount, failureCount };
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
