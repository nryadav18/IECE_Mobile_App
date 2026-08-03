const User = require('../models/User');
const School = require('../models/School');
const Attendance = require('../models/Attendance');
const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;
const { notifyRole } = require('../utils/pushNotification');
const { notify } = require('../utils/notify');
const { getApproverIdsFor, approverLabelFor } = require('../utils/hierarchy');
const { ROLE_LABELS } = require('../utils/roleLabels');

const roleLabel = (role) => ROLE_LABELS[role] || role;
const { isSchoolOffDay } = require('../utils/holiday');
const {
  getActiveSubstituteAssignment,
  getActiveSubjectLeave,
  getSubjectLeaveWindows,
  getSubstituteDutyWindows,
} = require('../utils/substitutionStatus');
const { getApprovedLeaveWindows } = require('../utils/leaveStatus');
const {
  DISPLAY_RADIUS_M,
  MAX_REGISTRATION_ACCURACY_M,
  MAX_VERIFICATION_ACCURACY_M,
  getDistanceFromLatLonInM,
  isWithinGeofence,
  parseCoordinates,
  parseAccuracy,
} = require('../utils/geofence');

// Keep the coarse legacy aggregate face status in sync with the per-school
// registrations, so older reads and the app's faceStatus gate stay meaningful.
function syncLegacyFaceStatus(user) {
  const regs = user.faceRegistrations || [];
  if (regs.some(r => r.status === 'approved')) {
    user.facialRegistrationStatus = 'approved';
    user.facialRegistrationStatusV2 = 'approved';
  } else if (regs.some(r => r.status === 'pending')) {
    user.facialRegistrationStatus = 'pending';
    user.facialRegistrationStatusV2 = 'pending';
  } else {
    user.facialRegistrationStatus = 'none';
    user.facialRegistrationStatusV2 = 'none';
  }
}

exports.registerFace = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    // A registration anchors every future check-in, so the fix has to be real
    // and reasonably precise before we save it.
    const coords = parseCoordinates(lat, lng);
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message });
    }
    const acc = parseAccuracy(accuracy, MAX_REGISTRATION_ACCURACY_M);
    if (!acc.ok) {
      return res.status(400).json({ success: false, message: acc.message });
    }

    // Call ML service to extract embedding and check liveness
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    
    let mlResponse;
    try {
      mlResponse = await axios.post(`${process.env.ML_SERVICE_API}/extract`, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
    } catch (error) {
      const msg = error.response?.data?.detail || 'Error communicating with ML service';
      return res.status(400).json({ success: false, message: msg });
    }
    
    const embedding = mlResponse.data.embedding;

    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
    
    let result = { secure_url: null };
    try {
      result = await cloudinary.uploader.upload(dataURI, { folder: 'facial_registrations', resource_type: 'video' });
    } catch (err) {
      console.error('Cloudinary upload failed:', err);
    }

    const user = await User.findById(req.user.id);
    user.facialRegistrationStatus = 'pending';
    user.faceEmbedding = embedding;
    user.registrationLocation = { lat: coords.lat, lng: coords.lng };
    user.registrationPhotoUrl = result.secure_url;

    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Facial registration submitted for approval',
      data: {
         status: user.facialRegistrationStatus
      }
    });

    // Notify admins that a new facial registration needs approval.
    notifyRole(
      'creator_admin',
      '🧑‍💼 New Facial Registration',
      `${user.name} submitted a facial registration for your approval.`,
      { type: 'face_registration_pending' }
    ).catch(err => console.error('Face-registration notification error:', err.message));

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyFace = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const coords = parseCoordinates(lat, lng);
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message });
    }
    const acc = parseAccuracy(accuracy, MAX_VERIFICATION_ACCURACY_M);
    if (!acc.ok) {
      return res.status(400).json({ success: false, message: acc.message });
    }

    const user = await User.findById(req.user.id);
    
    if (user.facialRegistrationStatus !== 'approved') {
      return res.status(400).json({ success: false, message: 'Facial registration is not approved yet' });
    }

    if (!user.schoolId) {
      return res.status(400).json({ success: false, message: 'Trainer is not assigned to a school' });
    }

    // 1. Check Location against the registered anchor.
    const registeredLat = user.registrationLocation.lat;
    const registeredLng = user.registrationLocation.lng;

    if (registeredLat == null || registeredLng == null) {
       return res.status(400).json({ success: false, message: 'Registration location not found' });
    }

    const distance = getDistanceFromLatLonInM(coords.lat, coords.lng, registeredLat, registeredLng);

    if (!isWithinGeofence(distance)) {
      return res.status(400).json({
        success: false,
        message: `Location verification failed. You are ${Math.round(distance)} meters away from the registered location. Must be within ${DISPLAY_RADIUS_M} meters.`
      });
    }

    // 2. Face Verification
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    formData.append('target_embedding', user.faceEmbedding.join(','));
    
    let mlResponse;
    try {
      mlResponse = await axios.post(`${process.env.ML_SERVICE_API}/verify`, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
    } catch (error) {
      const msg = error.response?.data?.detail || 'Error communicating with ML service';
      return res.status(400).json({ success: false, message: msg });
    }
    
    if (!mlResponse.data.match) {
      return res.status(400).json({ success: false, message: 'Face verification failed. Not a match.' });
    }

    // 3. Mark Attendance
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingAttendance = await Attendance.findOne({
      trainerId: user._id,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingAttendance) {
      return res.status(400).json({ success: false, message: 'Attendance already marked for today' });
    }

    const attendance = await Attendance.create({
      trainerId: user._id,
      schoolId: user.schoolId,
      date: new Date(),
      status: 'Present',
      checkInLocation: { lat: coords.lat, lng: coords.lng, accuracy: acc.accuracy },
      verifiedViaFace: true
    });
    
    res.status(200).json({
      success: true,
      message: 'Attendance verified and marked successfully',
      data: attendance
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMyAttendance = async (req, res) => {
  try {
    const [attendanceRecords, substitutionLeaves, substitutionDuties, leaveDays] = await Promise.all([
      Attendance.find({ trainerId: req.user._id })
        .populate('schoolId', 'name state')
        // Populated too, so a day split across two schools can be shown as
        // "checked in at A, checked out at B".
        .populate('checkOutSchoolId', 'name state')
        .sort({ date: -1 }),
      // Windows where this user was REPLACED by someone else. They are not
      // expected at work, so the client paints these days as "On Leave".
      getSubjectLeaveWindows(req.user._id),
      // Windows where this user is COVERING for someone else. Painted as
      // "On Substitution" — until they actually check in, at which point their
      // real attendance colour takes over for that day.
      getSubstituteDutyWindows(req.user._id),
      // Approved personal leave windows — painted as "On Leave" on the calendar.
      getApprovedLeaveWindows(req.user._id),
    ]);

    res.status(200).json({
      success: true,
      data: attendanceRecords,
      substitutionLeaves,
      substitutionDuties,
      leaveDays
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.registerFaceV2 = async (req, res) => {
  try {
    const { lat, lng, accuracy, schoolId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    // This fix becomes the permanent geofence anchor for this school, so a
    // vague or bogus reading is refused up front — accepting one here is what
    // makes later check-ins report absurd distances.
    const coords = parseCoordinates(lat, lng);
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message });
    }
    const acc = parseAccuracy(accuracy, MAX_REGISTRATION_ACCURACY_M);
    if (!acc.ok) {
      return res.status(400).json({ success: false, message: acc.message });
    }

    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'Please select which school you are registering at.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // The person must actually be assigned to this school to register there.
    const assigned = (user.schoolIds || []).map(String);
    if (!assigned.includes(String(schoolId))) {
      return res.status(400).json({ success: false, message: 'You are not assigned to this school.' });
    }

    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });

    let mlResponse;
    try {
      mlResponse = await axios.post(`${process.env.ML_SERVICE_API}/extract-v2`, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
    } catch (error) {
      const msg = error.response?.data?.detail || 'Error communicating with ML service';
      return res.status(400).json({ success: false, message: msg });
    }

    const embedding = mlResponse.data.embedding;

    // Reject when the ML service could not find a valid face / blink in the
    // video. Without a usable embedding we must NOT save anything as pending.
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ success: false, message: 'No face detected. Please keep your face clearly in the frame, blink 2–3 times, and try again.' });
    }

    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = "data:" + req.file.mimetype + ";base64," + b64;

    let result = { secure_url: null };
    try {
      result = await cloudinary.uploader.upload(dataURI, { folder: 'facial_registrations_v2', resource_type: 'video' });
    } catch (err) {
      console.error('Cloudinary upload failed:', err);
    }

    const registrationLocation = { lat: coords.lat, lng: coords.lng };

    // Upsert the per-school registration. Re-registering resets it to pending
    // so the admin approves the fresh capture for that school again.
    const existing = (user.faceRegistrations || []).find(
      (fr) => String(fr.schoolId) === String(schoolId)
    );
    if (existing) {
      existing.status = 'pending';
      existing.faceEmbedding = embedding;
      existing.registrationLocation = registrationLocation;
      existing.locationAccuracy = acc.accuracy;
      existing.registrationPhotoUrl = result.secure_url;
      // Re-registering wipes the previous decision — this is a fresh request.
      existing.rejectionReason = null;
      existing.reviewedBy = null;
      existing.reviewedAt = null;
    } else {
      user.faceRegistrations.push({
        schoolId,
        status: 'pending',
        faceEmbedding: embedding,
        registrationLocation,
        locationAccuracy: acc.accuracy,
        registrationPhotoUrl: result.secure_url
      });
    }

    // Keep the legacy fields pointing at the most recent registration + status.
    user.faceEmbeddingV2 = embedding;
    user.registrationLocation = registrationLocation;
    user.registrationPhotoUrl = result.secure_url;
    syncLegacyFaceStatus(user);

    await user.save();

    res.status(200).json({
      success: true,
      message: `Facial registration sent to ${approverLabelFor(user)} for approval`,
      data: {
        schoolId,
        status: 'pending'
      }
    });

    // Everything past this point runs AFTER the response has been sent, so it
    // must never throw — the outer catch could not answer anymore, and an
    // escaping rejection would take the process down.
    try {
      const school = await School.findById(schoolId).select('name');
      const schoolName = school ? school.name : 'a school';

      // Up the chain of command, not straight to the admin: a trainer's request
      // goes to their team leader, a leader's to their head, a head's to
      // Admin/CEO — who are also always included as a fallback.
      const approverIds = await getApproverIdsFor(user);
      await notify(approverIds, {
        type: 'face_registration_pending',
        title: '🧑‍💼 New Facial Registration',
        body: `${user.name} (${roleLabel(user.role)}) submitted a facial registration for ${schoolName} for your approval.`,
        data: { userId: String(user._id), schoolId: String(schoolId) },
      });
    } catch (err) {
      console.error('Face-registration notification error:', err.message);
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyFaceV2 = async (req, res) => {
  try {
    const { lat, lng, accuracy, intent, schoolId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const coords = parseCoordinates(lat, lng);
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message });
    }
    const acc = parseAccuracy(accuracy, MAX_VERIFICATION_ACCURACY_M);
    if (!acc.ok) {
      return res.status(400).json({ success: false, message: acc.message });
    }

    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'Please select which school you are marking attendance at.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Being substituted: someone else was approved to cover for this user, so
    // they are not expected at work until the window ends. Attendance is paused
    // and those days show as "On Leave" on their calendar.
    const subjectLeave = await getActiveSubjectLeave(user._id, new Date());
    if (subjectLeave) {
      return res.status(400).json({
        success: false,
        message: `You are on leave until ${new Date(
          subjectLeave.approvedToDate || subjectLeave.toDate
        ).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} because someone is covering for you. Attendance is paused until then.`,
      });
    }

    // Substitution duty: if this user is an approved SUBSTITUTE whose window
    // covers today, they are temporarily deployed away from their registered
    // school, so the geofence check is skipped (identity is still verified via
    // their existing face registration for the school they pick).
    const substituteAssignment = await getActiveSubstituteAssignment(user._id, new Date());
    const geofenceBypassed = Boolean(substituteAssignment);

    // Resolve the per-school registration for the selected school. Everything
    // downstream (geofence anchor, face embedding) is scoped to THIS school.
    const reg = (user.faceRegistrations || []).find(
      (fr) => String(fr.schoolId) === String(schoolId)
    );
    if (!reg) {
      return res.status(400).json({ success: false, message: 'You have not registered your face for this school yet.' });
    }
    if (reg.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Your facial registration for this school is not approved yet.' });
    }

    // Block check-in / check-out on approved holidays for THIS school. Sundays
    // are NOT blocked — trainers sometimes work them.
    if (await isSchoolOffDay(schoolId)) {
      return res.status(400).json({ success: false, message: 'Attendance is disabled today — it is a holiday.' });
    }

    // 1. Location check against this school's own registration anchor.
    //    Skipped entirely for an active substitute — they may check in/out
    //    anywhere for the duration of their approved window.
    if (!geofenceBypassed) {
      const registeredLat = reg.registrationLocation && reg.registrationLocation.lat;
      const registeredLng = reg.registrationLocation && reg.registrationLocation.lng;

      if (registeredLat == null || registeredLng == null) {
        return res.status(400).json({ success: false, message: 'Registration location not found for this school.' });
      }

      const distance = getDistanceFromLatLonInM(coords.lat, coords.lng, registeredLat, registeredLng);

      if (!isWithinGeofence(distance)) {
        return res.status(400).json({
          success: false,
          message: `Location verification failed. You are ${Math.round(distance)} meters away from this school's registered location. Must be within ${DISPLAY_RADIUS_M} meters.`
        });
      }
    }

    // 2. Face verification against this school's embedding.
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    formData.append('target_embedding', (reg.faceEmbedding || []).join(','));

    let mlResponse;
    try {
      mlResponse = await axios.post(`${process.env.ML_SERVICE_API}/verify-v2`, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
    } catch (error) {
      const msg = error.response?.data?.detail || 'Error communicating with ML service';
      return res.status(400).json({ success: false, message: msg });
    }

    if (!mlResponse.data.match) {
      return res.status(400).json({ success: false, message: 'Face verification failed. Not a match.' });
    }

    // 3. Mark Attendance — one record per person per day, tied to the school
    //    they checked in at. Check-out must happen at that same school.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingAttendance = await Attendance.findOne({
      trainerId: user._id,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (intent === 'logout') {
      if (!existingAttendance) {
        return res.status(400).json({ success: false, message: 'You must check in before you can check out.' });
      }

      if (existingAttendance.checkOutTime) {
        return res.status(400).json({ success: false, message: 'You have already checked out today.' });
      }

      // Check-out may happen at a DIFFERENT school from check-in — staff who
      // cover several schools often work one in the morning and another in the
      // afternoon. Nothing extra is needed to make that safe: `reg` above is
      // this school's own registration, so the face was matched against the
      // embedding approved HERE and the geofence was measured against THIS
      // school's anchor. The day is simply recorded as spanning both.
      const movedSchools = String(existingAttendance.schoolId) !== String(schoolId);

      existingAttendance.checkOutTime = new Date();
      existingAttendance.checkOutSchoolId = schoolId;
      existingAttendance.checkOutLocation = { lat: coords.lat, lng: coords.lng, accuracy: acc.accuracy };
      existingAttendance.status = 'Present';

      const diffMs = existingAttendance.checkOutTime - existingAttendance.checkInTime;
      existingAttendance.totalTimeSpent = Math.round(diffMs / 60000);

      await existingAttendance.save();

      let message = 'Checked out successfully. Status is Present.';
      if (movedSchools) {
        const checkedInSchool = await School.findById(existingAttendance.schoolId).select('name');
        const fromName = checkedInSchool ? checkedInSchool.name : 'another school';
        message = `Checked out successfully. Your day is recorded from ${fromName} to here. Status is Present.`;
      }

      return res.status(200).json({
        success: true,
        message,
        data: existingAttendance
      });

    } else {
      // It's a check-in / login.
      //
      // Still ONE check-in per day. Moving between schools during the day is
      // expected, but the day starts once — the second school is captured by
      // checking OUT there, not by checking in again.
      if (existingAttendance) {
        if (String(existingAttendance.schoolId) !== String(schoolId)) {
          const checkedInSchool = await School.findById(existingAttendance.schoolId).select('name');
          const name = checkedInSchool ? checkedInSchool.name : 'another school';
          const advice = existingAttendance.checkOutTime
            ? 'Your day is already complete.'
            : 'If you have moved here for the rest of the day, check out here instead.';
          return res.status(400).json({
            success: false,
            message: `You already checked in at ${name} today. ${advice}`
          });
        }
        return res.status(400).json({ success: false, message: 'You have already checked in for today.' });
      }

      const attendance = await Attendance.create({
        trainerId: user._id,
        schoolId,
        date: new Date(),
        status: 'Partially Present',
        checkInTime: new Date(),
        checkInLocation: { lat: coords.lat, lng: coords.lng, accuracy: acc.accuracy },
        verifiedViaFace: true,
        geofenceBypassed,
        substitutionRequestId: substituteAssignment ? substituteAssignment._id : null
      });

      return res.status(200).json({
        success: true,
        message: 'Checked in successfully. Status is Partially Present until you check out.',
        data: attendance
      });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.provideLogoutReason = async (req, res) => {
  try {
     const { attendanceId, reason } = req.body;
     if (!reason) {
       return res.status(400).json({ success: false, message: 'Reason is required' });
     }
     
     const attendance = await Attendance.findOne({
        _id: attendanceId,
        trainerId: req.user._id
     });
     
     if (!attendance) {
        return res.status(404).json({ success: false, message: 'Attendance record not found' });
     }
     
     if (attendance.checkOutTime) {
        return res.status(400).json({ success: false, message: 'Already checked out properly' });
     }
     
     attendance.logoutReason = reason;
     await attendance.save();
     
     res.status(200).json({
       success: true,
       message: 'Logout reason saved successfully',
       data: attendance
     });
  } catch(error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
