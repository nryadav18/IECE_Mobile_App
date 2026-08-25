const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles } = require('../controllers/uploadController');
const { upload, finalizeUploads } = require('../utils/storage');
const { protect } = require('../middleware/auth');

// We use 'file' as the field name expected from the frontend
// `finalizeUploads` puts the bytes in R2, generates the derivatives (resized
// image widths, and the poster frame that installed app builds guess at for a
// video), and then sets `req.file.path` to the delivery URL. That property name
// is why the storage move was invisible to clients: controllers and phones both
// read exactly what they always did.
router.post('/', protect, upload.single('file'), finalizeUploads, uploadFile);
router.post('/multiple', protect, upload.array('files', 10), finalizeUploads, uploadMultipleFiles);

module.exports = router;
