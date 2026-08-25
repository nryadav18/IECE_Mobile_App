exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // `req.file.path` is the delivery URL, set by storage.finalizeUploads.
    // The property name is historic and deliberately unchanged: it is what every
    // installed app build reads, so the move between storage providers never
    // required a client update.
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
