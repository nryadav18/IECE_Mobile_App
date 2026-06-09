const Media = require('../models/Media');
const { deleteFromCloudinary } = require('../utils/cloudinary');

exports.getMedia = async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'chairman') {
      query.status = 'approved';
    }
    const media = await Media.find(query).populate('uploaderId', 'name').sort('-createdAt');
    res.status(200).json({ success: true, count: media.length, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createMedia = async (req, res) => {
  try {
    req.body.uploaderId = req.user.id;
    // Set status to pending by default for team leaders, but approved for admins
    req.body.status = req.user.role === 'creator_admin' ? 'approved' : 'pending';
    
    const media = await Media.create(req.body);
    res.status(201).json({ success: true, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateMediaStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const media = await Media.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!media) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    res.status(200).json({ success: true, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    if (media.imageUrl) {
      await deleteFromCloudinary(media.imageUrl);
    }

    await media.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
