const School = require('../models/School');
const User = require('../models/User');

exports.getSchools = async (req, res) => {
  try {
    const { state } = req.query;
    let query = {};
    if (state) query.state = state;
    const schools = await School.find(query).populate('chairmanId', 'name email');
    res.status(200).json({ success: true, count: schools.length, data: schools });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id).populate('chairmanId', 'name email');
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    res.status(200).json({ success: true, data: school });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createSchool = async (req, res) => {
  try {
    const school = await School.create(req.body);
    res.status(201).json({ success: true, data: school });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getFacultyRoster = async (req, res) => {
  try {
    const faculty = await User.find({ 
      schoolId: req.params.id, 
      role: 'trainer' 
    }).select('-password');
    
    res.status(200).json({ success: true, count: faculty.length, data: faculty });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.uploadMou = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    school.mouPdfUrl = req.body.mouPdfUrl || school.mouPdfUrl;
    await school.save();
    
    res.status(200).json({ success: true, data: school });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
