const User = require('../models/User');
const School = require('../models/School');
const Attendance = require('../models/Attendance');
const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;
const { purgeFaceVideo, purgeLegacyFaceVideo } = require('../utils/faceVideo');
const { notifyRole } = require('../utils/pushNotification');
const { notify } = require('../utils/notify');
const { getAdminOnlyRecipientIds } = require('../utils/hierarchy');
const {
  isAnonymousStaff,
  findAnonymousRegistration,
  findSchoolRegistration,
} = require('../utils/anonymousLocation');
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
const { getApprovedVisitWindows, getActiveVisit } = require('../utils/schoolVisitStatus');
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

    // This capture replaces the last one, and the field below is the only thing
    // that remembers the previous video's URL. Delete it before overwriting it,
    // or that file stays in the account with nothing left pointing at it.
    await purgeLegacyFaceVideo(user, result.secure_url);

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
    const [attendanceRecords, substitutionLeaves, substitutionDuties, leaveDays, visitDays] = await Promise.all([
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
      // Approved school-visit windows — painted "On School Visit". Unlike the
      // three above these are ON-DUTY days (working, just off-site), so they
      // count as worked in every attendance summary.
      getApprovedVisitWindows(req.user._id),
    ]);

    res.status(200).json({
      success: true,
      data: attendanceRecords,
      substitutionLeaves,
      substitutionDuties,
      leaveDays,
      visitDays
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.registerFaceV2 = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // An anonymous-location head registers ONCE, against no school. Nothing is
    // being anchored, so the strict location rules below would only be an
    // obstacle: a fix is recorded if the phone offers one and skipped if it
    // does not. Everyone else is anchoring a permanent geofence and is held to
    // the full standard.
    const anonymous = isAnonymousStaff(user);
    const schoolId = anonymous ? null : req.body.schoolId;

    let coords = { ok: true, lat: null, lng: null };
    let acc = { ok: true, accuracy: null };

    if (anonymous) {
      // Best-effort: parse what arrived, keep it if it is usable, never refuse.
      const parsed = parseCoordinates(lat, lng);
      if (parsed.ok) coords = parsed;
      const parsedAcc = parseAccuracy(accuracy, Number.POSITIVE_INFINITY);
      if (parsedAcc.ok) acc = parsedAcc;
    } else {
      // This fix becomes the permanent geofence anchor for this school, so a
      // vague or bogus reading is refused up front — accepting one here is what
      // makes later check-ins report absurd distances.
      coords = parseCoordinates(lat, lng);
      if (!coords.ok) {
        return res.status(400).json({ success: false, message: coords.message });
      }
      acc = parseAccuracy(accuracy, MAX_REGISTRATION_ACCURACY_M);
      if (!acc.ok) {
        return res.status(400).json({ success: false, message: acc.message });
      }

      if (!schoolId) {
        return res.status(400).json({ success: false, message: 'Please select which school you are registering at.' });
      }

      // The person must actually be assigned to this school to register there.
      const assigned = (user.schoolIds || []).map(String);
      if (!assigned.includes(String(schoolId))) {
        return res.status(400).json({ success: false, message: 'You are not assigned to this school.' });
      }
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

    // For an anonymous head this is a note of where they happened to be, not an
    // anchor anything is measured against; it may legitimately be empty.
    const registrationLocation = { lat: coords.lat, lng: coords.lng };

    // Upsert the registration. Re-registering resets it to pending so the admin
    // approves the fresh capture again. An anonymous head has exactly one,
    // matched by having NO school rather than by matching one.
    const existing = anonymous
      ? findAnonymousRegistration(user)
      : findSchoolRegistration(user, schoolId);
    if (existing) {
      // This capture replaces the previous one, so the previous VIDEO is now
      // orphaned — the field below is about to be overwritten with the new URL
      // and nothing would remember the old file. Delete it before we lose the
      // only reference to it. Best-effort: a storage hiccup must not stop
      // somebody re-registering their face.
      if (existing.registrationPhotoUrl && existing.registrationPhotoUrl !== result.secure_url) {
        await purgeFaceVideo(user, existing);
      }
      existing.status = 'pending';
      existing.faceEmbedding = embedding;
      existing.registrationLocation = registrationLocation;
      existing.locationAccuracy = acc.accuracy;
      existing.registrationPhotoUrl = result.secure_url;
      // Re-registering wipes the previous decision — this is a fresh request.
      existing.rejectionReason = null;
      existing.reviewedBy = null;
      existing.reviewedAt = null;
      existing.decidedBy = null;
    } else {
      user.faceRegistrations.push({
        schoolId: schoolId || null,
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
      message: 'Facial registration sent to the admin for approval',
      data: {
        schoolId,
        status: 'pending'
      }
    });

    // Everything past this point runs AFTER the response has been sent, so it
    // must never throw — the outer catch could not answer anymore, and an
    // escaping rejection would take the process down.
    try {
      let schoolName = 'a school';
      if (schoolId) {
        const school = await School.findById(schoolId).select('name');
        if (school) schoolName = school.name;
      }
      const where = anonymous ? 'anonymous location (no school)' : schoolName;

      // Straight to the Admin, who is now the only person who may decide a
      // facial registration (see FACE_APPROVERS). Notifying the team leader or
      // head would only ask them for a decision the app refuses to let them
      // make. Activity approvals still follow the chain of command.
      const approverIds = await getAdminOnlyRecipientIds();
      await notify(approverIds, {
        type: 'face_registration_pending',
        title: '🧑‍💼 New Facial Registration',
        body: `${user.name} (${roleLabel(user.role)}) submitted a facial registration for ${where} for your approval.`,
        data: { userId: String(user._id), schoolId: schoolId ? String(schoolId) : 'anonymous' },
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
    const { lat, lng, accuracy, intent } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // An anonymous-location head marks attendance from wherever they are. There
    // is no school to name and no anchor to measure against, so location is
    // recorded when the phone can supply it and never gates anything.
    const anonymous = isAnonymousStaff(user);
    const schoolId = anonymous ? null : req.body.schoolId;

    let coords = { ok: true, lat: null, lng: null };
    let acc = { ok: true, accuracy: null };

    if (anonymous) {
      const parsed = parseCoordinates(lat, lng);
      if (parsed.ok) coords = parsed;
      const parsedAcc = parseAccuracy(accuracy, Number.POSITIVE_INFINITY);
      if (parsedAcc.ok) acc = parsedAcc;
    } else {
      coords = parseCoordinates(lat, lng);
      if (!coords.ok) {
        return res.status(400).json({ success: false, message: coords.message });
      }
      acc = parseAccuracy(accuracy, MAX_VERIFICATION_ACCURACY_M);
      if (!acc.ok) {
        return res.status(400).json({ success: false, message: acc.message });
      }

      if (!schoolId) {
        return res.status(400).json({ success: false, message: 'Please select which school you are marking attendance at.' });
      }
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

    // On an approved school visit: the person is out inspecting another school,
    // so they cannot be at their own. Check-in AND check-out are paused for the
    // whole window and resume automatically the day after it ends — the day is
    // already recorded as "On School Visit" (on-duty) on their calendar.
    const activeVisit = await getActiveVisit(user._id, new Date());
    if (activeVisit) {
      const until = new Date(activeVisit.toDate).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      const where = activeVisit.school ? ` to ${activeVisit.school.name}` : '';
      return res.status(400).json({
        success: false,
        message: `You are on an approved school visit${where} until ${until}. Check-in and check-out are paused until then — these days are already marked "On School Visit".`,
      });
    }

    // Substitution duty: if this user is an approved SUBSTITUTE whose window
    // covers today, they are temporarily deployed away from their registered
    // school, so the geofence check is skipped (identity is still verified via
    // their existing face registration for the school they pick).
    const substituteAssignment = await getActiveSubstituteAssignment(user._id, new Date());
    const geofenceBypassed = Boolean(substituteAssignment);

    // Resolve the registration behind this attempt. Everything downstream (the
    // geofence anchor, the face embedding) comes from it. For an anonymous head
    // that is their single school-less registration; for everyone else it is
    // scoped to the school they picked.
    const reg = anonymous
      ? findAnonymousRegistration(user)
      : findSchoolRegistration(user, schoolId);
    if (!reg) {
      return res.status(400).json({
        success: false,
        message: anonymous
          ? 'You have not registered your face yet.'
          : 'You have not registered your face for this school yet.',
      });
    }
    if (reg.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: anonymous
          ? 'Your facial registration is not approved yet.'
          : 'Your facial registration for this school is not approved yet.',
      });
    }

    // Block check-in / check-out on approved holidays for THIS school. Sundays
    // are NOT blocked — trainers sometimes work them. An anonymous head belongs
    // to no school, so no school's holiday can close their day.
    if (!anonymous && await isSchoolOffDay(schoolId)) {
      return res.status(400).json({ success: false, message: 'Attendance is disabled today — it is a holiday.' });
    }

    // 1. Location check against this school's own registration anchor.
    //    Skipped entirely for an active substitute — they may check in/out
    //    anywhere for the duration of their approved window — and for an
    //    anonymous head, who has no anchor to be measured against at all.
    if (!geofenceBypassed && !anonymous) {
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
      // An anonymous head has no school on either end, so a day can never
      // "span two schools" for them.
      const movedSchools = !anonymous && String(existingAttendance.schoolId) !== String(schoolId);

      existingAttendance.checkOutTime = new Date();
      existingAttendance.checkOutSchoolId = schoolId || null;
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
        if (!anonymous && String(existingAttendance.schoolId) !== String(schoolId)) {
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
        // Null for an anonymous head — a real day's work that belongs to no
        // school, and therefore to no school's numbers.
        schoolId: schoolId || null,
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
