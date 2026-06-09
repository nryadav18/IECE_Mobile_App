const User = require('../models/User');
const Attendance = require('../models/Attendance');
const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;

// Distance calculator using Haversine formula
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radius of the earth in m
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in m
  return d;
}

exports.registerFace = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }
    
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    // Call ML service to extract embedding and check liveness
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    
    let mlResponse;
    try {
      mlResponse = await axios.post('${process.env.ML_SERVICE_API}/extract', formData, {
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
    user.registrationLocation = { lat: parseFloat(lat), lng: parseFloat(lng) };
    user.registrationPhotoUrl = result.secure_url;
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Facial registration submitted for approval',
      data: {
         status: user.facialRegistrationStatus
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyFace = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }
    
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    const user = await User.findById(req.user.id);
    
    if (user.facialRegistrationStatus !== 'approved') {
      return res.status(400).json({ success: false, message: 'Facial registration is not approved yet' });
    }

    if (!user.schoolId) {
      return res.status(400).json({ success: false, message: 'Trainer is not assigned to a school' });
    }

    // 1. Check Location (50 meters logic)
    const registeredLat = user.registrationLocation.lat;
    const registeredLng = user.registrationLocation.lng;
    
    if (!registeredLat || !registeredLng) {
       return res.status(400).json({ success: false, message: 'Registration location not found' });
    }

    const distance = getDistanceFromLatLonInM(parseFloat(lat), parseFloat(lng), registeredLat, registeredLng);
    
    if (distance > 50) {
      return res.status(400).json({ 
        success: false, 
        message: `Location verification failed. You are ${Math.round(distance)} meters away from the registered location. Must be within 50 meters.` 
      });
    }

    // 2. Face Verification
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    formData.append('target_embedding', user.faceEmbedding.join(','));
    
    let mlResponse;
    try {
      mlResponse = await axios.post('${process.env.ML_SERVICE_API}/verify', formData, {
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
      checkInLocation: { lat: parseFloat(lat), lng: parseFloat(lng) },
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
    const attendanceRecords = await Attendance.find({ trainerId: req.user._id })
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: attendanceRecords
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.registerFaceV2 = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }
    
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    
    let mlResponse;
    try {
      mlResponse = await axios.post('${process.env.ML_SERVICE_API}/extract-v2', formData, {
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
      result = await cloudinary.uploader.upload(dataURI, { folder: 'facial_registrations_v2', resource_type: 'video' });
    } catch (err) {
      console.error('Cloudinary upload failed:', err);
    }

    const user = await User.findById(req.user.id);
    user.facialRegistrationStatusV2 = 'pending';
    user.faceEmbeddingV2 = embedding;
    user.registrationLocation = { lat: parseFloat(lat), lng: parseFloat(lng) };
    user.registrationPhotoUrl = result.secure_url;
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Facial registration v2 submitted for approval',
      data: {
         status: user.facialRegistrationStatusV2
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyFaceV2 = async (req, res) => {
  try {
    const { lat, lng, intent } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }
    
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    const user = await User.findById(req.user.id);
    
    if (user.facialRegistrationStatusV2 !== 'approved') {
      return res.status(400).json({ success: false, message: 'Facial registration v2 is not approved yet' });
    }

    if (!user.schoolId && user.role !== 'team_leader') {
      return res.status(400).json({ success: false, message: 'Trainer is not assigned to a school' });
    }

    // 1. Check Location (50 meters logic)
    const registeredLat = user.registrationLocation.lat;
    const registeredLng = user.registrationLocation.lng;
    
    if (!registeredLat || !registeredLng) {
       return res.status(400).json({ success: false, message: 'Registration location not found' });
    }

    const distance = getDistanceFromLatLonInM(parseFloat(lat), parseFloat(lng), registeredLat, registeredLng);
    
    if (distance > 50) {
      return res.status(400).json({ 
        success: false, 
        message: `Location verification failed. You are ${Math.round(distance)} meters away from the registered location. Must be within 50 meters.` 
      });
    }

    // 2. Face Verification
    const formData = new FormData();
    formData.append('file', req.file.buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    formData.append('target_embedding', user.faceEmbeddingV2.join(','));
    
    let mlResponse;
    try {
      mlResponse = await axios.post('${process.env.ML_SERVICE_API}/verify-v2', formData, {
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

    // 3. Mark Attendance (Login / Logout Logic)
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
         return res.status(400).json({ success: false, message: 'You must log in before you can log out.' });
      }
      if (existingAttendance.checkOutTime) {
         return res.status(400).json({ success: false, message: 'You have already logged out today.' });
      }
      
      existingAttendance.checkOutTime = new Date();
      existingAttendance.checkOutLocation = { lat: parseFloat(lat), lng: parseFloat(lng) };
      existingAttendance.status = 'Present';
      
      // Calculate total time in minutes
      const diffMs = existingAttendance.checkOutTime - existingAttendance.checkInTime;
      existingAttendance.totalTimeSpent = Math.round(diffMs / 60000);
      
      await existingAttendance.save();
      
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully. Status is Present.',
        data: existingAttendance
      });
      
    } else {
      // It's a login
      if (existingAttendance) {
         return res.status(400).json({ success: false, message: 'You have already logged in for today.' });
      }

      const attendance = await Attendance.create({
        trainerId: user._id,
        schoolId: user.schoolId || null,
        date: new Date(),
        status: 'Partially Present',
        checkInTime: new Date(),
        checkInLocation: { lat: parseFloat(lat), lng: parseFloat(lng) },
        verifiedViaFace: true
      });
      
      return res.status(200).json({
        success: true,
        message: 'Logged in successfully. Status is Partially Present until you log out.',
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
