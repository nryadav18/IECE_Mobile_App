const mongoose = require('mongoose');

// One row per (month, recipient) — proof that a monthly performance report was
// already delivered to that person for that month.
//
// This exists for exactly one reason: the report must go out ONCE. A cron is
// not a guarantee. A redeploy at 06:00 IST on the 1st, a restart, a second app
// instance behind a load balancer, or an admin re-running the job by hand would
// all otherwise re-send the whole organisation a duplicate. The unique index
// below is what makes "exactly once" true rather than merely likely — a second
// attempt loses the race at the database and is skipped, not sent.
//
// It also makes a PARTIAL failure recoverable: if Brevo rejects the 30th of 50
// emails, re-running the job resumes from there instead of spamming the 29
// people who already got theirs.
//
// NOTE ON WHAT IS *NOT* STORED: the PDF itself. It is built in memory, attached
// to the email, and discarded — the report lives in the recipient's inbox and
// nowhere else, which is what was asked for. This collection holds only the few
// bytes needed to answer "did this already go out?".
const monthlyReportRunSchema = new mongoose.Schema(
  {
    // The month the report covers, as 'YYYY-MM' in IST (see utils/monthlyReport/period).
    period: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
      index: true,
    },
    // Who the email was addressed to.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Snapshot, so the log stays readable after a person is renamed or removed.
    recipientEmail: { type: String, default: null },
    recipientName: { type: String, default: null },
    recipientRole: { type: String, default: null },

    // Which bundle they received:
    //   individual  - their own report only (trainers)
    //   manager     - their own report + a condensed page per person under them
    //   organisation- the whole-org report (Admin and CEO)
    bundle: {
      type: String,
      enum: ['individual', 'manager', 'organisation'],
      required: true,
    },
    // How many people's numbers were inside the attachment (1 for an individual).
    subjectCount: { type: Number, default: 1 },

    // 'sending' is the CLAIM: written before the email leaves, so a second
    // instance racing the same person loses at the unique index instead of
    // sending a duplicate. It becomes 'sent' or 'failed' the moment Brevo
    // answers. A row left 'sending' means the process died mid-send; the
    // sender treats one older than STALE_CLAIM_MINUTES as retryable.
    status: {
      type: String,
      enum: ['sending', 'sent', 'failed', 'skipped'],
      required: true,
      index: true,
    },
    // Why a send failed / was skipped. Kept so a failed month can be diagnosed
    // without re-running anything.
    error: { type: String, default: null },

    sentAt: { type: Date, default: Date.now },
    pdfBytes: { type: Number, default: 0 },
    // True when produced by scripts/testMonthlyReport.js rather than the cron,
    // so test runs are obvious in the log and never block a real send.
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// The guarantee. A duplicate insert for the same person and month fails with
// E11000, which the sender treats as "already delivered" and skips.
// Test runs are excluded from the constraint via a partial index so testing a
// month never consumes that month's real send.
monthlyReportRunSchema.index(
  { period: 1, recipient: 1 },
  { unique: true, partialFilterExpression: { isTest: false } }
);

module.exports = mongoose.model('MonthlyReportRun', monthlyReportRunSchema);
