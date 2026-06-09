const express = require('express');
const { register, login, getMe, updateMe, forgotPassword, verifyOtp, resetPassword, savePushToken } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/updatedetails', protect, updateMe);
router.post('/forgotpassword', forgotPassword);
router.post('/verifyotp', verifyOtp);
router.put('/resetpassword', resetPassword);
router.put('/push-token', protect, savePushToken);

module.exports = router;
