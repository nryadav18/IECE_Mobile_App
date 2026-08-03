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
const cors = require('cors');
const connectDB = require('./config/db');
const { startAttendanceReminderCron } = require('./utils/attendanceReminderCron');
const { startCelebrationCron } = require('./utils/celebrationCron');

// Connect to database
connectDB();

// Schedule the hourly (5–10 PM IST) "please check out" attendance reminders.
startAttendanceReminderCron();

// Wish everyone at 08:00 IST on festivals, national days and IECE's own
// anniversary — the same occasions the home screen header celebrates.
startCelebrationCron();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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
const meetingRoutes = require('./routes/meetingRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const statsRoutes = require('./routes/statsRoutes');
const occasionRoutes = require('./routes/occasionRoutes');
const appVersionRoutes = require('./routes/appVersionRoutes');

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
app.use('/api/meetings', meetingRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/occasions', occasionRoutes);
app.use('/api/app-version', appVersionRoutes);

const PORT = process.env.PORT || 3000;

// Safety net. On modern Node an unhandled promise rejection terminates the
// process by default, so one stray background task (a push notification, a
// post-response lookup) could take the whole API down. Log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
