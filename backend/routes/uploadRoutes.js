const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles } = require('../controllers/uploadController');
const { upload, finalizeUploads, handleUploadErrors } = require('../utils/storage');
const { protect } = require('../middleware/auth');

// We use 'file' as the field name expected from the frontend
// `finalizeUploads` puts the bytes in R2, generates the derivatives (resized
// image widths, and the poster frame that installed app builds guess at for a
// video), and then sets `req.file.path` to the delivery URL. That property name
// is why the storage move was invisible to clients: controllers and phones both
// read exactly what they always did.
//
// `?scope=leave-proof` restricts an upload to photographs. See UPLOAD_SCOPES in
// utils/storage — the claim in the query string is checked against the actual
// bytes, so it cannot be used to smuggle a document through.
router.post('/', protect, upload.single('file'), finalizeUploads, uploadFile);
router.post('/multiple', protect, upload.array('files', 10), finalizeUploads, uploadMultipleFiles);

// Must come last: it converts a rejected file into a message the person can
// read, instead of a generic 500 that says nothing about why.
router.use(handleUploadErrors);

module.exports = router;
