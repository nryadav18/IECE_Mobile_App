const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { sendWelcomeNotification, sendPushNotification } = require('../utils/pushNotification');
const { isFirebaseAvailable } = require('../utils/firebase');

// Get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId
    }
  });
};

exports.register = async (req, res) => {
  try {
    const { name, email, password, role, schoolId } = req.body;
    const user = await User.create({
      name,
      email,
      password,
      role,
      schoolId
    });
    sendTokenResponse(user, 201, res);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide an email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Increment tokenVersion to invalidate existing tokens on other devices
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const fieldsToUpdate = {};
    if (req.body.timetablePdfUrl) fieldsToUpdate.timetablePdfUrl = req.body.timetablePdfUrl;
    if (req.body.classesHandled) fieldsToUpdate.classesHandled = req.body.classesHandled;

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.savePushToken = async (req, res) => {
  try {
    const { expoPushToken, welcome } = req.body;

    // Capture the token currently on file BEFORE we overwrite it — this is the
    // previously-logged-in device, which we may need to force-logout.
    const existing = await User.findById(req.user.id).select('expoPushToken');
    const previousToken = existing?.expoPushToken || null;

    if (expoPushToken) {
      // Clear this push token from any other users to guarantee uniqueness
      await User.updateMany(
        { expoPushToken, _id: { $ne: req.user.id } },
        { $set: { expoPushToken: null } }
      );
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { expoPushToken: expoPushToken || null },
      { new: true }
    );

    // Visibility: confirms the registration request actually reached this server.
    console.log(
      `[push-token] user=${req.user.id} token=${expoPushToken ? expoPushToken.slice(0, 14) + '…' : 'null'} welcome=${!!welcome}`
    );

    // Respond first so the client isn't blocked on the push round-trip.
    res.status(200).json({ success: true, message: 'Push token updated' });

    // Fire a personalized welcome only when this registration came from a
    // fresh login (not an app-launch refresh or a logout token-clear).
    if (welcome && expoPushToken) {
      sendWelcomeNotification(user).catch(err =>
        console.error('Welcome notification error:', err.message)
      );

      // Single-session enforcement: a DIFFERENT device just logged into this
      // account, so immediately push a force-logout to the previous device.
      // (tokenVersion already invalidated its session server-side; this makes
      // the logout instant while that device is foregrounded.) The token-diff
      // guard avoids logging out the same device when it simply re-logs in.
      if (previousToken && previousToken !== expoPushToken) {
        console.log(`[force-logout] notifying previous device for user=${req.user.id}`);
        sendPushNotification(
          previousToken,
          'Signed out',
          'Your account was just signed in on another device.',
          { type: 'force_logout' }
        ).catch(err => console.error('Force-logout push error:', err.message));
      }
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// Diagnostic endpoint: sends a test push to the logged-in user's stored token
// and returns the full result (plus diagnostics) directly in the HTTP response,
// so delivery can be verified without reading server logs.
exports.testPush = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    const diagnostics = {
      firebaseAvailable: isFirebaseAvailable(),
      hasToken: !!user.expoPushToken,
      tokenPreview: user.expoPushToken ? user.expoPushToken.slice(0, 14) + '…' : null,
    };

    if (!diagnostics.firebaseAvailable) {
      return res.status(200).json({
        success: false,
        reason: 'Firebase Admin is not initialized on the server (missing/invalid service account key).',
        diagnostics,
      });
    }
    if (!user.expoPushToken) {
      return res.status(200).json({
        success: false,
        reason: 'No push token stored for this user. Open the app on a physical device to register one.',
        diagnostics,
      });
    }

    const result = await sendPushNotification(
      user.expoPushToken,
      '🔔 IECE Test Notification',
      'If you can see this, push notifications are working perfectly! 🎉',
      { type: 'test' }
    );

    res.status(200).json({ success: result.successCount > 0, result, diagnostics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const { sendOtp, generateOtp } = require('../utils/email');

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, error: 'There is no user with that email' });
    }

    const otp = generateOtp();
    user.resetPasswordOtp = otp;
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    const sent = await sendOtp(user.email, otp);
    if (!sent) {
      user.resetPasswordOtp = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, error: 'Email could not be sent' });
    }

    res.status(200).json({ success: true, data: 'Email sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({
      email,
      resetPasswordOtp: otp,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+resetPasswordOtp +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    res.status(200).json({ success: true, data: 'OTP verified successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    
    const user = await User.findOne({
      email,
      resetPasswordOtp: otp,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+resetPasswordOtp +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    user.password = password;
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpire = undefined;

    // Increment tokenVersion on password reset to force logout on all other devices
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
