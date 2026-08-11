const { sendEmail } = require('../email');
const { ROLE_LABELS } = require('../roleLabels');
const { periodLabel, periodFileLabel } = require('./period');

// ---------------------------------------------------------------------------
// The email the report arrives in.
//
// Deliberately SHORT. The detail lives in the attached PDF; the body's job is
// to be readable in a notification preview and on a phone lock screen, to say
// the four numbers that matter, and to get out of the way. A long HTML body
// would be clipped by Gmail at ~102KB anyway, and a manager's bundle could
// never fit.
//
// Styling is inline and table-based on purpose — Outlook ignores <style> blocks
// and flexbox, and this has to render in whatever the staff actually use.
// ---------------------------------------------------------------------------

const BRAND = '#0D9488';
const roleLabel = (role) => ROLE_LABELS[role] || role;

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A 2x2 grid of headline figures. Table-based so Outlook renders it. */
function statGrid(stats) {
  const cell = (s) => `
    <td width="50%" style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#F8FAFA;border:1px solid #E5E7EB;border-radius:10px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:11px;color:#6B7280;letter-spacing:0.4px;text-transform:uppercase;font-weight:600;">${esc(s.label)}</div>
          <div style="font-size:24px;font-weight:800;color:${s.color || '#111827'};line-height:1.25;padding-top:4px;">${esc(s.value)}</div>
          <div style="font-size:11px;color:#9CA3AF;padding-top:2px;">${esc(s.hint || '')}</div>
        </td></tr>
      </table>
    </td>`;

  let html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
  for (let i = 0; i < stats.length; i += 2) {
    html += `<tr>${cell(stats[i])}${stats[i + 1] ? cell(stats[i + 1]) : '<td width="50%"></td>'}</tr>`;
  }
  return `${html}</table>`;
}

/**
 * The full email body.
 *
 * @param {object} o
 * @param {string} o.greetingName
 * @param {string} o.period       - 'YYYY-MM'
 * @param {string} o.headline     - the lead sentence
 * @param {Array}  o.stats        - up to 4 { label, value, hint, color }
 * @param {object} [o.score]      - { score, grade } to render the score banner
 * @param {string} [o.note]       - an extra paragraph above the sign-off
 * @param {string} o.fileName     - the attached PDF's name
 */
function buildHtml({ greetingName, period, headline, stats = [], score = null, note = '', fileName }) {
  const label = periodLabel(period);

  const scoreBanner = score ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${score.grade.color}14;border:1px solid ${score.grade.color}33;border-radius:12px;margin:0 0 6px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;color:#6B7280;letter-spacing:0.5px;text-transform:uppercase;font-weight:700;">Overall performance</div>
          <div style="padding-top:6px;">
            <span style="font-size:34px;font-weight:800;color:${score.grade.color};">${score.score}</span>
            <span style="font-size:14px;color:#9CA3AF;font-weight:600;">/ 100</span>
            <span style="display:inline-block;margin-left:10px;padding:5px 13px;border-radius:999px;background:${score.grade.color};color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.4px;">${esc(score.grade.grade)} · ${esc(score.grade.label).toUpperCase()}</span>
          </div>
        </td>
      </tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Monthly Performance Report — ${esc(label)}</title></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:'Inter',Helvetica,Arial,sans-serif;color:#1F2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.10),0 8px 10px -6px rgba(0,0,0,0.10);">

        <tr><td style="background:${BRAND};padding:30px 28px;">
          <div style="font-size:11px;color:#B2DFD9;letter-spacing:2px;text-transform:uppercase;font-weight:700;">IECE Dashboard</div>
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:23px;font-weight:800;letter-spacing:0.2px;">Monthly Performance Report</h1>
          <div style="margin-top:5px;color:#D7EFEC;font-size:14px;font-weight:600;">${esc(label)}</div>
        </td></tr>

        <tr><td style="padding:30px 28px 8px;">
          <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#111827;">Dear ${esc(greetingName)},</p>
          <p style="margin:0 0 22px;font-size:14.5px;line-height:1.65;color:#4B5563;">${headline}</p>
          ${scoreBanner}
        </td></tr>

        <tr><td style="padding:10px 20px 4px;">${statGrid(stats)}</td></tr>

        <tr><td style="padding:18px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#F8FAFA;border:1px dashed #CBD5E1;border-radius:10px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:13px;font-weight:700;color:#111827;">Your full report is attached</div>
              <div style="font-size:12.5px;color:#6B7280;padding-top:5px;line-height:1.55;">
                <span style="color:${BRAND};font-weight:700;">${esc(fileName)}</span><br>
                It contains the day-by-day attendance calendar, every activity listed, school visits and
                reports, leave and holidays, working hours, and a full breakdown of how the score above was calculated.
              </div>
            </td></tr>
          </table>
        </td></tr>

        ${note ? `<tr><td style="padding:18px 28px 0;">
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:#4B5563;">${note}</p>
        </td></tr>` : ''}

        <tr><td style="padding:22px 28px 26px;">
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:#4B5563;">
            If anything in this report looks wrong, please raise it with your reporting line so it can be
            corrected in the app — next month's report is generated from the same records.
          </p>
          <p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#4B5563;">
            Warm regards,<br><strong style="color:#111827;">IECE Management</strong>
          </p>
        </td></tr>

        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:18px 28px;text-align:center;">
          <p style="margin:0 0 4px;font-size:11.5px;color:#9CA3AF;">Generated automatically on the first of the month. Please do not reply to this email.</p>
          <p style="margin:0;font-size:11.5px;color:#9CA3AF;">Confidential — intended for the named recipient only. &copy; ${new Date().getFullYear()} IECE.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Plaintext fallback, built from the same inputs so the two cannot diverge. */
function buildText({ greetingName, period, headline, stats = [], score = null, fileName }) {
  return [
    `IECE — Monthly Performance Report`,
    periodLabel(period),
    '',
    `Dear ${greetingName},`,
    '',
    headline.replace(/<[^>]+>/g, ''),
    '',
    score ? `Overall performance: ${score.score}/100 (${score.grade.grade} — ${score.grade.label})` : '',
    '',
    ...stats.map((s) => `  ${s.label}: ${s.value}${s.hint ? ` (${s.hint})` : ''}`),
    '',
    `Your full report is attached as ${fileName}.`,
    '',
    'Generated automatically on the first of the month. Please do not reply.',
    'Confidential — intended for the named recipient only.',
  ].filter((l) => l !== null && l !== undefined).join('\n');
}

/** A safe PDF filename: 'Performance_Report_Ramesh_Kumar_Aug-2026.pdf'. */
function fileNameFor(name, period, prefix = 'Performance_Report') {
  const safe = String(name || 'Report').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return `${prefix}_${safe}_${periodFileLabel(period)}.pdf`;
}

/**
 * Send one report email with its PDF attached.
 * @returns {Promise<boolean>} whether Brevo accepted it
 */
async function sendReportEmail({ to, toName, subject, pdf, fileName, ...body }) {
  const html = buildHtml({ ...body, fileName });
  const text = buildText({ ...body, fileName });

  if (!process.env.BREVO_API_KEY) {
    console.log(`[monthly-report] STUB (no BREVO_API_KEY) -> ${to}: "${subject}" + ${fileName} (${(pdf.length / 1024).toFixed(0)} KB)`);
    return true;
  }

  return sendEmail(to, subject, text, html, {
    senderName: 'IECE Management',
    toName: toName || 'Colleague',
    attachments: [{ name: fileName, content: pdf }],
  });
}

module.exports = { buildHtml, buildText, fileNameFor, sendReportEmail, roleLabel };
