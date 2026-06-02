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

const sendEmail = async (to, subject, text, html) => {
    if (!process.env.BREVO_API_KEY || !brevo) {
        console.warn("[Brevo] No API Key provided. Email skipped.");
        return false;
    }
    
    const senderEmail = process.env.BREVO_FROM_EMAIL || "info@iece.com";

    try {
        const response = await brevo.transactionalEmails.sendTransacEmail({
            subject: subject,
            sender: { "name": "IECE Security", "email": senderEmail },
            to: [{ "email": to, "name": "User" }],
            htmlContent: html || `<strong>${text}</strong>`,
            textContent: text
        });
        console.log(`[Brevo] Email sent to ${to} from ${senderEmail}`);
        return true;
    } catch (error) {
        console.error('[Brevo] Error sending email:', error);
        if (error.response) {
             console.error(error.response.body);
        }
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

module.exports = { sendOtp, generateOtp, sendEmail };
