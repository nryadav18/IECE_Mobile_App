const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles } = require('../controllers/uploadController');
const { upload, finalizeUploads } = require('../utils/storage');
const { protect } = require('../middleware/auth');

// We use 'file' as the field name expected from the frontend
// `finalizeUploads` is what puts the bytes in R2 and then sets `req.file.path`
// to the delivery URL — the same property multer-storage-cloudinary set, so the
// controllers and every installed app build see an unchanged response. It is a
// no-op while STORAGE_DRIVER is `cloudinary`.
router.post('/', protect, upload.single('file'), finalizeUploads, uploadFile);
router.post('/multiple', protect, upload.array('files', 10), finalizeUploads, uploadMultipleFiles);

module.exports = router;
