const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth');
const {
  registerFace,
  verifyFace,
  getMyAttendance,
  registerFaceV2,
  verifyFaceV2,
  provideLogoutReason
} = require('../controllers/attendanceController');

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB for video uploads
});

router.post('/register-face', protect, authorize('trainer', 'team_leader'), upload.single('video'), registerFace);
router.post('/verify-face', protect, authorize('trainer', 'team_leader'), upload.single('video'), verifyFace);
router.get('/my-attendance', protect, authorize('trainer', 'team_leader'), getMyAttendance);

// V2 Routes
router.post('/register-face-v2', protect, authorize('trainer', 'team_leader'), upload.single('video'), registerFaceV2);
router.post('/verify-face-v2', protect, authorize('trainer', 'team_leader'), upload.single('video'), verifyFaceV2);
router.post('/logout-reason', protect, authorize('trainer', 'team_leader'), provideLogoutReason);

module.exports = router;
