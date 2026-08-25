const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { sendWelcomeNotification, sendPushNotification } = require('../utils/pushNotification');
const { isFirebaseAvailable } = require('../utils/firebase');
const { findUserByEmail } = require('../utils/findUser');

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
      schoolId: user.schoolId,
      teamLeaderId: user.teamLeaderId,
      teamId: user.teamId,
      teamIds: user.teamIds || []
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

// ---------------------------------------------------------------------------
// SIGNING IN, AND SIGNING THE PREVIOUS DEVICE OUT.
//
// The policy is one device at a time: the newest login wins and the older
// session is ended. That is enforced by `tokenVersion` — every issued token
// carries the version it was minted at, middleware/auth.js rejects any token
// whose version no longer matches, and logging in bumps it.
//
// THE BUG THIS REPLACES
//
// The increment used to be `user.tokenVersion += 1; await user.save()`, which
// is a read-modify-write across two round trips on a document the rest of the
// app is constantly touching — attendance, notifications, push tokens. If
// anything else wrote to that user in between, mongoose's version check failed
// the save with a VersionError, the outer catch turned it into a 400, and the
// app showed "Login failed" to somebody whose password was perfectly correct.
//
// Worse, it failed exactly when it mattered most: two people using one account
// is precisely the situation where a concurrent write is likely, so the
// second person was told login failed instead of the first being signed out.
//
// `$inc` is a single atomic operation. It cannot conflict, it does not run
// document validation or save hooks, and it needs no prior read.
// ---------------------------------------------------------------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide an email and password' });
    }

    const { user, ambiguous } = await findUserByEmail(email, '+password');

    if (ambiguous) {
      // More than one account matches this address case-insensitively. Picking
      // one would sign somebody into an account that is not theirs, silently.
      console.error(`[login] AMBIGUOUS EMAIL "${String(email).trim()}" matches multiple accounts — refusing.`);
      return res.status(409).json({
        success: false,
        error: 'More than one account uses this email address. Please contact your administrator.',
      });
    }

    if (!user) {
      // The user is told the same thing either way — revealing which half was
      // wrong is a gift to anyone guessing. The log records the difference so
      // a real support question can be answered.
      console.warn(`[login] no account for "${String(email).trim()}"`);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      console.warn(`[login] wrong password for ${user.email}`);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Atomic. Ends any session on another device, and cannot fail the way the
    // old read-modify-write could.
    const updated = await User.findByIdAndUpdate(
      user._id,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    );

    if (!updated) {
      // The account was removed between the password check and now.
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    sendTokenResponse(updated, 200, res);
  } catch (error) {
    console.error('[login] unexpected failure:', error);
    res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    // Populate assigned schools and per-school face registrations (with school
    // names) so the app can render the multi-school attendance UI. Face
    // embeddings are large and never needed client-side, so drop them.
    const user = await User.findById(req.user.id)
      .select('-faceEmbedding -faceEmbeddingV2 -faceRegistrations.faceEmbedding')
      .populate('schoolIds', 'name state associationYear classCoverage')
      .populate('faceRegistrations.schoolId', 'name state');
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
      returnDocument: 'after',
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
      { returnDocument: 'after' }
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

// The OTP is written with an atomic $set rather than user.save(), for the same
// reason login uses $inc: a full-document save on a record the rest of the app
// writes to can fail a version check, and "OTP not sent" for an address that
// plainly exists is exactly what that failure looks like from outside.
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const { user, ambiguous } = await findUserByEmail(email);

    if (ambiguous) {
      console.error(`[otp] AMBIGUOUS EMAIL "${String(email).trim()}" matches multiple accounts — refusing.`);
      return res.status(409).json({
        success: false,
        error: 'More than one account uses this email address. Please contact your administrator.',
      });
    }
    if (!user) {
      return res.status(404).json({ success: false, error: 'There is no user with that email' });
    }

    const otp = generateOtp();
    await User.updateOne(
      { _id: user._id },
      { $set: { resetPasswordOtp: otp, resetPasswordExpire: new Date(Date.now() + 10 * 60 * 1000) } }
    );

    const sent = await sendOtp(user.email, otp);
    if (!sent) {
      // Do not leave a live OTP behind for a code nobody received.
      await User.updateOne({ _id: user._id }, { $unset: { resetPasswordOtp: '', resetPasswordExpire: '' } });
      console.error(`[otp] send FAILED for ${user.email} — see the email log above for the provider's reason.`);
      return res.status(502).json({
        success: false,
        error: 'We could not send the email just now. Please try again in a moment.',
      });
    }

    console.log(`[otp] sent to ${user.email}`);
    res.status(200).json({ success: true, data: 'Email sent' });
  } catch (error) {
    console.error('[otp] unexpected failure:', error);
    res.status(500).json({ success: false, error: 'Could not send the code. Please try again.' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    // Resolve the account the same way login does, THEN check the code against
    // it. Matching on the typed email inside the query would reintroduce the
    // case-sensitivity bug at the last step of a password reset.
    const { user: found } = await findUserByEmail(email, '+resetPasswordOtp +resetPasswordExpire');

    const valid = found
      && found.resetPasswordOtp
      && String(found.resetPasswordOtp) === String(otp).trim()
      && found.resetPasswordExpire
      && found.resetPasswordExpire.getTime() > Date.now();

    if (!valid) {
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

    const { user } = await findUserByEmail(email, '+resetPasswordOtp +resetPasswordExpire');

    const valid = user
      && user.resetPasswordOtp
      && String(user.resetPasswordOtp) === String(otp).trim()
      && user.resetPasswordExpire
      && user.resetPasswordExpire.getTime() > Date.now();

    if (!valid) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    // This save has to stay a save: the pre-save hook is what hashes the
    // password, and bypassing it would store the password in clear text. The
    // atomic $inc that login uses is therefore not available here — but a
    // password reset is not a concurrent operation the way a login is, and the
    // retry below covers the rare case.
    user.password = password;
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpire = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    try {
      await user.save();
    } catch (error) {
      if (error.name !== 'VersionError') throw error;
      // Something else wrote to this user mid-reset. Re-read and reapply once
      // rather than telling the person their reset failed.
      const fresh = await User.findById(user._id);
      fresh.password = password;
      fresh.resetPasswordOtp = undefined;
      fresh.resetPasswordExpire = undefined;
      fresh.tokenVersion = (fresh.tokenVersion || 0) + 1;
      await fresh.save();
      return sendTokenResponse(fresh, 200, res);
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
