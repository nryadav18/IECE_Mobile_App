const cron = require('node-cron');
const User = require('../models/User');
const { notify } = require('./notify');
const { occasionsToday } = require('./occasionCalendar');

/**
 * The morning wish.
 *
 * At 08:00 IST on any day the app is celebrating, everyone gets one
 * notification carrying that day's wish — the same wish the home screen header
 * is showing them, resolved from the same catalogue.
 *
 * Design notes:
 *   · **One notification, not one per occasion.** 14 April is Ambedkar
 *     Jayanti, Puthandu and Vishu; three pushes in a row would read as spam.
 *     The highest-priority occasion leads and the rest are named in the body.
 *   · **`notify()`, not `sendPushNotification()`.** That keeps an inbox record
 *     and the push in lock-step, which is how every other feature here works.
 *   · **Everyone, no filtering.** Celebrations are deliberately not scoped by
 *     role, team or region — the whole company sees the same header.
 */

const EMOJI = {
  'independence-day': '🇮🇳',
  'republic-day': '🇮🇳',
  diwali: '🪔',
  holi: '🎨',
  'iece-anniversary': '🎉',
  'teachers-day': '🎓',
  'childrens-day': '🎈',
  'sankranti-pongal': '🪁',
  onam: '🌸',
  'ganesh-chaturthi': '🌺',
  'eid-al-fitr': '🌙',
  'eid-al-adha': '🌙',
  christmas: '🎄',
  'new-year': '✨',
};

function buildMessage(occasions) {
  const lead = occasions[0];
  const emoji = EMOJI[lead.key] || '✨';
  const title = `${emoji} ${lead.wish}`;

  const others = occasions.slice(1).map((o) => o.name);
  const body = others.length
    ? `From everyone at IECE. Today is also ${others.join(' and ')}.`
    : 'From everyone at IECE.';

  return { title, body };
}

/**
 * Resolve today's occasions and wish everyone with a registered device.
 * Exported so it can be run by hand while testing.
 */
async function sendCelebrationWishes(now = new Date()) {
  try {
    const occasions = await occasionsToday(now);
    if (occasions.length === 0) {
      console.log('[celebration] Nothing to celebrate today — no wishes sent.');
      return { sent: 0 };
    }

    const users = await User.find({ expoPushToken: { $ne: null } }).select('_id');
    if (users.length === 0) {
      console.log('[celebration] No registered devices to wish.');
      return { sent: 0 };
    }

    const { title, body } = buildMessage(occasions);

    const result = await notify(users.map((u) => u._id), {
      type: 'celebration',
      title,
      body,
      // Tapping opens Home, which is already showing the header this refers to.
      data: { occasionKey: occasions[0].key },
    });

    console.log(
      `[celebration] "${title}" → ${result.pushed}/${users.length} devices ` +
      `(${occasions.map((o) => o.name).join(', ')}).`
    );
    return { sent: result.pushed };
  } catch (err) {
    console.error('[celebration] Job error:', err.message);
    return { sent: 0 };
  }
}

let task = null;

/**
 * 08:00 IST daily. The job itself decides whether today is a celebration, so
 * it is cheap on the ~320 days a year that it isn't.
 */
function startCelebrationCron() {
  if (task) return task; // guard against double-registration

  task = cron.schedule('0 8 * * *', () => sendCelebrationWishes(), {
    timezone: 'Asia/Kolkata',
  });

  console.log('[celebration] Cron scheduled: daily wish at 08:00 IST.');
  return task;
}

module.exports = { startCelebrationCron, sendCelebrationWishes, buildMessage };
