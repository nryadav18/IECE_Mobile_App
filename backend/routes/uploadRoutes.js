const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles } = require('../controllers/uploadController');
const { upload } = require('../utils/cloudinary');
const { protect } = require('../middleware/auth');

// We use 'file' as the field name expected from the frontend
router.post('/', protect, upload.single('file'), uploadFile);
router.post('/multiple', protect, upload.array('files', 10), uploadMultipleFiles);

module.exports = router;
