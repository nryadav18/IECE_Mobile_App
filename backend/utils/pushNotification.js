const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a native push notification to one or more Expo push tokens.
 * @param {string|string[]} to - Expo push token(s)
 * @param {string} title
 * @param {string} body
 * @param {object} data - Extra payload (optional)
 */
const sendPushNotification = async (to, title, body, data = {}) => {
  const tokens = Array.isArray(to) ? to : [to];
  const validTokens = tokens.filter(t => t && t.startsWith('ExponentPushToken['));

  if (validTokens.length === 0) return;

  const messages = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    badge: 1,
  }));

  try {
    await axios.post(EXPO_PUSH_URL, messages, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
};

module.exports = { sendPushNotification };
