const Brevo = require('@getbrevo/brevo');

// Initialize the single master client with your API key
let brevo;
if (process.env.BREVO_API_KEY) {
    brevo = new Brevo.BrevoClient({ 
        apiKey: process.env.BREVO_API_KEY 
    });
} else {
    console.warn("[Brevo] No API Key provided. Alerts skipped.");
}

/**
 * Generates a premium HTML email template for OTP.
 * Features: Glassmorphism, animations, and clean topography.
 * @param {string} otp - The 6-digit OTP code
 * @returns {string} - Complete HTML string
 */
const getOtpTemplate = (otp) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OTP Verification</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            
            body {
                margin: 0;
                padding: 0;
                font-family: 'Inter', Helvetica, Arial, sans-serif;
                background-color: #f3f4f6;
                color: #1f2937;
            }
            .container {
                max-width: 500px;
                margin: 40px auto;
                padding: 0;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #0D9488 0%, #0D9488 100%);
                padding: 30px 20px;
                text-align: center;
            }
            .header h1 {
                margin: 0;
                color: #ffffff;
                font-size: 24px;
                font-weight: 700;
                letter-spacing: 0.5px;
            }
            .content {
                padding: 40px 30px;
                text-align: center;
            }
            .greeting {
                font-size: 18px;
                color: #374151;
                margin-bottom: 20px;
                font-weight: 600;
            }
            .message {
                font-size: 15px;
                color: #4b5563;
                line-height: 1.6;
                margin-bottom: 30px;
                text-align: left;
            }
            .otp-container {
                background: linear-gradient(145deg, #eff6ff, #f5f3ff);
                border: 1px solid #c7d2fe;
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
                display: inline-block;
                width: 100%;
                box-sizing: border-box;
                position: relative;
                overflow: hidden;
            }
            .otp-code {
                font-size: 36px;
                font-weight: 800;
                color: #0D9488;
                letter-spacing: 8px;
                line-height: 1;
                margin: 0;
                display: block;
            }
            .expiry {
                font-size: 13px;
                color: #6b7280;
                margin-top: 10px;
            }
            .footer {
                background-color: #f9fafb;
                padding: 20px;
                text-align: center;
                border-top: 1px solid #e5e7eb;
                font-size: 12px;
                color: #9ca3af;
            }
            .footer p {
                margin: 5px 0;
            }
            .highlight {
                color: #0D9488;
                font-weight: 600;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Verification Request</h1>
            </div>
            <div class="content">
                <p class="greeting">Dear User,</p>
                <div class="message">
                    We received a request to verify your identity. To proceed, please use the One-Time Password (OTP) provided below:
                </div>
                
                <div class="otp-container">
                    <span class="otp-code">${otp}</span>
                </div>

                <div class="message" style="text-align: center; margin-bottom: 10px;">
                    This OTP is valid for <span class="highlight">10 minutes</span> from the time of generation.
                </div>
                
                <div class="message">
                    For security reasons, please do not share this code with anyone. If you did not initiate this request, please ignore this email. No changes will be made to your account unless this OTP is used.
                </div>

                <div class="message" style="margin-top: 30px;">
                    Should you require further assistance, feel free to contact our support team.
                    <br><br>
                    Thank you for choosing our service.
                    <br><br>
                    Warm regards,<br>
                    <strong>Security & Support Team</strong>
                </div>
            </div>
            <div class="footer">
                <p>This is an automated message. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} IECE Dashboard. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

/**
 * Generates a premium, branded HTML email for a substitution event (request
 * raised / approved / rejected). Reuses the IECE teal look of the OTP email.
 * @param {object} opts
 * @param {string} opts.title    - big header line (e.g. "Substitution Request Raised")
 * @param {string} opts.intro    - one-line lead paragraph
 * @param {Array<{label:string,value:string}>} opts.rows - detail rows
 * @param {string} [opts.accent] - hex accent colour for the status pill
 * @param {string} [opts.badge]  - short status label shown as a pill
 * @returns {string} complete HTML string
 */
const getSubstitutionTemplate = ({ title, intro, rows = [], accent = '#0D9488', badge = '' }) => {
    const rowsHtml = rows
        .filter((r) => r && r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
        .map(
            (r) => `
                <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #eef2f7;font-size:13px;color:#6b7280;width:42%;vertical-align:top;">${r.label}</td>
                    <td style="padding:10px 0;border-bottom:1px solid #eef2f7;font-size:14px;color:#111827;font-weight:600;">${r.value}</td>
                </tr>`
        )
        .join('');

    const badgeHtml = badge
        ? `<div style="display:inline-block;margin-top:14px;padding:6px 16px;border-radius:999px;background:${accent}1a;color:${accent};font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${badge}</div>`
        : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
    </head>
    <body style="margin:0;padding:0;font-family:'Inter',Helvetica,Arial,sans-serif;background-color:#f3f4f6;color:#1f2937;">
        <div style="max-width:540px;margin:40px auto;background:#ffffff;border-radius:16px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.1),0 8px 10px -6px rgba(0,0,0,0.1);overflow:hidden;">
            <div style="background:linear-gradient(135deg, ${accent} 0%, ${accent} 100%);padding:30px 24px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">${title}</h1>
                ${badgeHtml}
            </div>
            <div style="padding:34px 30px;">
                <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 22px;">${intro}</p>
                <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
                <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:28px 0 0;">
                    You are receiving this email because you are part of the reporting hierarchy for this substitution. Please log in to the IECE app for full details.
                </p>
            </div>
            <div style="background-color:#f9fafb;padding:20px;text-align:center;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
                <p style="margin:5px 0;">This is an automated message. Please do not reply to this email.</p>
                <p style="margin:5px 0;">&copy; ${new Date().getFullYear()} IECE Dashboard. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

/**
 * Generic branded event email (reuses the IECE teal look). Used for leave
 * request / approval / rejection notices. Same card as the substitution email
 * but with a neutral footer line.
 * @param {object} opts - { title, intro, rows, accent, badge, footerNote }
 */
const getEventTemplate = ({ title, intro, rows = [], accent = '#0D9488', badge = '', footerNote = '' }) => {
    const rowsHtml = rows
        .filter((r) => r && r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
        .map(
            (r) => `
                <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #eef2f7;font-size:13px;color:#6b7280;width:42%;vertical-align:top;">${r.label}</td>
                    <td style="padding:10px 0;border-bottom:1px solid #eef2f7;font-size:14px;color:#111827;font-weight:600;">${r.value}</td>
                </tr>`
        )
        .join('');

    const badgeHtml = badge
        ? `<div style="display:inline-block;margin-top:14px;padding:6px 16px;border-radius:999px;background:${accent}1a;color:${accent};font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${badge}</div>`
        : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
    </head>
    <body style="margin:0;padding:0;font-family:'Inter',Helvetica,Arial,sans-serif;background-color:#f3f4f6;color:#1f2937;">
        <div style="max-width:540px;margin:40px auto;background:#ffffff;border-radius:16px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.1),0 8px 10px -6px rgba(0,0,0,0.1);overflow:hidden;">
            <div style="background:linear-gradient(135deg, ${accent} 0%, ${accent} 100%);padding:30px 24px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">${title}</h1>
                ${badgeHtml}
            </div>
            <div style="padding:34px 30px;">
                <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 22px;">${intro}</p>
                <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
                <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:28px 0 0;">
                    ${footerNote || 'Please log in to the IECE app for full details.'}
                </p>
            </div>
            <div style="background-color:#f9fafb;padding:20px;text-align:center;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
                <p style="margin:5px 0;">This is an automated message. Please do not reply to this email.</p>
                <p style="margin:5px 0;">&copy; ${new Date().getFullYear()} IECE Dashboard. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} text  - plaintext fallback
 * @param {string} html
 * @param {object} [options]
 * @param {Array<{name:string, content:Buffer|string}>} [options.attachments]
 *        Files to attach. `content` may be a Buffer (encoded here) or a string
 *        that is already base64. Attachments are passed inline to Brevo, so a
 *        generated file never has to be uploaded anywhere first — see
 *        utils/monthlyReport, which builds a PDF in memory and sends it without
 *        ever touching disk or cloud storage.
 * @param {string} [options.senderName] - overrides the default "IECE Security".
 * @param {string} [options.toName]
 */
const sendEmail = async (to, subject, text, html, options = {}) => {
    if (!process.env.BREVO_API_KEY || !brevo) {
        console.warn("[Brevo] No API Key provided. Email skipped.");
        return false;
    }

    const senderEmail = process.env.BREVO_FROM_EMAIL || "info@iece.com";
    const { attachments = [], senderName = 'IECE Security', toName = 'User' } = options;

    try {
        const payload = {
            subject: subject,
            sender: { "name": senderName, "email": senderEmail },
            to: [{ "email": to, "name": toName }],
            htmlContent: html || `<strong>${text}</strong>`,
            textContent: text
        };

        if (attachments.length) {
            payload.attachment = attachments.map((a) => ({
                name: a.name,
                content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
            }));
        }

        const suffix = attachments.length ? ` with ${attachments.length} attachment(s)` : '';

        // ------------------------------------------------------------------
        // ONE FAILED SEND IS NOT THE SAME AS A FAILED ADDRESS.
        //
        // A single attempt was the reason "the OTP did not arrive" happened to
        // addresses that plainly exist. Brevo, like any hosted API, produces
        // transient failures — a 429 when several notifications go out at once,
        // a 5xx during their deploys, a socket dropped mid-flight. None of those
        // say anything about the recipient, and all of them used to end as a
        // flat `false` and a password reset the person could not complete.
        //
        // A 4xx that is NOT 429 is different: a malformed address or a rejected
        // sender will fail identically forever, so retrying only delays telling
        // the truth.
        // ------------------------------------------------------------------
        const attempts = Number(process.env.EMAIL_SEND_ATTEMPTS || 3);
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                await brevo.transactionalEmails.sendTransacEmail(payload);
                if (attempt > 1) console.log(`[Brevo] Email to ${to} succeeded on attempt ${attempt}`);
                else console.log(`[Brevo] Email sent to ${to} from ${senderEmail}${suffix}`);
                return true;
            } catch (error) {
                lastError = error;
                const status = error.status || error.response?.statusCode || error.response?.status || null;
                const body = error.response?.body || error.response?.text || null;
                const permanent = status && status >= 400 && status < 500 && status !== 429;

                console.error(
                    `[Brevo] send to ${to} attempt ${attempt}/${attempts} failed`
                    + `${status ? ` (HTTP ${status})` : ''}: ${error.message}`
                );
                if (body) console.error('[Brevo] response body:', typeof body === 'string' ? body.slice(0, 500) : body);

                if (permanent) {
                    console.error(`[Brevo] HTTP ${status} is permanent — not retrying. `
                        + 'Check the recipient address and that the sender is verified in Brevo.');
                    return false;
                }
                if (attempt === attempts) break;
                await new Promise((r) => setTimeout(r, 500 * attempt));
            }
        }

        console.error(`[Brevo] GAVE UP sending to ${to} after ${attempts} attempts.`, lastError?.message);
        return false;
    } catch (error) {
        console.error('[Brevo] Error preparing email:', error);
        return false;
    }
};

const sendOtp = async (email, otp) => {
    const subject = 'Your Verification OTP';
    // Plain text fallback
    const text = `Dear User,\n\nYour OTP is: ${otp}\n\nThis OTP is valid for 10 minutes. For security reasons, please do not share this code with anyone.\n\nWarm regards,\nSecurity & Support Team`;
    
    // Premium HTML Template
    const html = getOtpTemplate(otp);

    // If no API key, fallback to log (dev mode)
    if (!process.env.BREVO_API_KEY) {
        console.log(`[OTP-STUB] (No API Key) Sending OTP ${otp} to ${email}`);
        return true;
    }

    return await sendEmail(email, subject, text, html);
};

const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send a branded substitution email to one recipient. Builds a plaintext
 * fallback from the same rows so email clients without HTML still read cleanly.
 * @param {string} to
 * @param {object} payload - { subject, title, intro, rows, accent, badge }
 */
const sendSubstitutionEmail = async (to, payload) => {
    const { subject, title, intro, rows = [], accent, badge } = payload;
    const html = getSubstitutionTemplate({ title, intro, rows, accent, badge });
    const text = [
        title,
        '',
        intro,
        '',
        ...rows
            .filter((r) => r && r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
            .map((r) => `${r.label}: ${r.value}`),
        '',
        'Please log in to the IECE app for full details.',
    ].join('\n');

    if (!process.env.BREVO_API_KEY) {
        console.log(`[SUBSTITUTION-EMAIL-STUB] (No API Key) -> ${to}: ${title}`);
        return true;
    }
    return await sendEmail(to, subject || title, text, html);
};

/**
 * Send a branded event email to one recipient (a request raised / approved /
 * rejected). Plaintext fallback built from the same rows.
 * @param {string} to
 * @param {object} payload - { subject, title, intro, rows, accent, badge, footerNote }
 * @param {string} tag - label used in the no-API-key stub log
 */
const sendEventEmail = async (to, payload, tag = 'EVENT') => {
    const { subject, title, intro, rows = [], accent, badge, footerNote } = payload;
    const html = getEventTemplate({ title, intro, rows, accent, badge, footerNote });
    const text = [
        title,
        '',
        intro,
        '',
        ...rows
            .filter((r) => r && r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
            .map((r) => `${r.label}: ${r.value}`),
        '',
        'Please log in to the IECE app for full details.',
    ].join('\n');

    if (!process.env.BREVO_API_KEY) {
        console.log(`[${tag}-EMAIL-STUB] (No API Key) -> ${to}: ${title}`);
        return true;
    }
    return await sendEmail(to, subject || title, text, html);
};

// Leave and School Visit share the same branded event template — only the
// stub-log tag differs, so each feature's logs stay readable.
const sendLeaveEmail = (to, payload) => sendEventEmail(to, payload, 'LEAVE');
const sendSchoolVisitEmail = (to, payload) => sendEventEmail(to, payload, 'SCHOOL-VISIT');

module.exports = { sendOtp, generateOtp, sendEmail, sendSubstitutionEmail, sendEventEmail, sendLeaveEmail, sendSchoolVisitEmail };
