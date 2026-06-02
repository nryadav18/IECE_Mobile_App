exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // req.file contains the Cloudinary info from multer-storage-cloudinary
    res.status(200).json({
      success: true,
      url: req.file.path,
      public_id: req.file.filename
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.uploadMultipleFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }
    
    const urls = req.files.map(file => file.path);
    
    res.status(200).json({
      success: true,
      urls: urls
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
