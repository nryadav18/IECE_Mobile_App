const dns = require('dns');
// Force Node to use Google DNS to bypass the ECONNREFUSED error
if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
}

// Load env vars FIRST — before any require that reads process.env at import
// time. utils/pushNotification.js runs initApns()/initFirebase() on load (pulled
// in transitively via attendanceReminderCron below), and APNs init needs
// APNS_KEY_ID/APNS_TEAM_ID to already be present or it permanently disables iOS push.
const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const connectDB = require('./config/db');
const { initRealtime } = require('./utils/realtime');
const { startAttendanceReminderCron } = require('./utils/attendanceReminderCron');
const { startCelebrationCron } = require('./utils/celebrationCron');
const { startSchoolVisitReportCron } = require('./utils/schoolVisitReportCron');
const { startMonthlyReportCron } = require('./utils/monthlyReportCron');

// Connect to database
connectDB();

// Schedule the hourly (5–10 PM IST) "please check out" attendance reminders.
startAttendanceReminderCron();

// Wish everyone at 08:00 IST on festivals, national days and IECE's own
// anniversary — the same occasions the home screen header celebrates.
startCelebrationCron();

// The morning after an approved school visit ends, remind the staff member to
// file the Visit Report for the school they inspected.
startSchoolVisitReportCron();

// 06:00 IST on the 1st of every month: email each staff member their previous
// month's performance report as a PDF, managers a bundle covering their people,
// and the Admin + CEO the organisation-wide report. The PDF is built in memory
// and attached to the email — it is never stored anywhere.
startMonthlyReportCron();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// "Approved by <name>" is Admin/CEO-only. Enforced on the way out for EVERY
// route rather than screen by screen, so no endpoint — including ones added
// later — can leak an approver's identity to the staff member they decided
// about. Also backfills the decidedBy snapshot on pre-feature records for
// Admin/CEO. Must sit above the routers.
const { approverVisibility } = require('./middleware/approverVisibility');
app.use(approverVisibility);

// Every successful write marks the live Monitoring dashboard dirty, so the
// socket ticker pushes a fresh snapshot within a second. Applied globally for
// the same reason as approverVisibility — a route added later is covered
// without anyone having to remember.
const { monitoringInvalidate } = require('./middleware/monitoringInvalidate');
app.use(monitoringInvalidate);

// Route files
const authRoutes = require('./routes/authRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const reportRoutes = require('./routes/reportRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const adminRoutes = require('./routes/adminRoutes');
const activityRoutes = require('./routes/activityRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const profileRoutes = require('./routes/profileRoutes');
const holidayRoutes = require('./routes/holidayRoutes');
const substitutionRoutes = require('./routes/substitutionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const schoolVisitRoutes = require('./routes/schoolVisitRoutes');
const meetingRoutes = require('./routes/meetingRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const approvalLogRoutes = require('./routes/approvalLogRoutes');
const statsRoutes = require('./routes/statsRoutes');
const occasionRoutes = require('./routes/occasionRoutes');
const appVersionRoutes = require('./routes/appVersionRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');

// Mount routers

app.get('/', (req, res) => res.send('API is running'))

app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/substitutions', substitutionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/school-visits', schoolVisitRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/approval-log', approvalLogRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/occasions', occasionRoutes);
app.use('/api/app-version', appVersionRoutes);
// Public and read-only — the maintenance screen has to reach the login screen.
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/monitoring', monitoringRoutes);

const PORT = process.env.PORT || 3000;

// Safety net. On modern Node an unhandled promise rejection terminates the
// process by default, so one stray background task (a push notification, a
// post-response lookup) could take the whole API down. Log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Express is served through an explicit http.Server so socket.io can share the
// same port — the live Monitoring dashboard is push-driven, not polled.
const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, () => console.log(`Server running on port ${PORT} (REST + realtime)`));
