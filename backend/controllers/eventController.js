const Event = require('../models/Event');
const { deleteFromCloudinary } = require('../utils/cloudinary');

exports.getEvents = async (req, res) => {
  try {
    let query = { status: 'approved' };
    if (req.query.uploaderId) {
      query.uploaderId = req.query.uploaderId;
    }
    
    const events = await Event.find(query)
      .populate('schoolId', 'name')
      .populate('organizers', 'name email role')
      .sort('-eventDate');
    res.status(200).json({ success: true, count: events.length, data: events });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('schoolId', 'name')
      .populate('organizers', 'name email role');
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    res.status(200).json({ success: true, data: event });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createEvent = async (req, res) => {
  try {
    req.body.uploaderId = req.user.id;
    const event = await Event.create(req.body);
    res.status(201).json({ success: true, data: event });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    let event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    // Check permission: owner or creator_admin
    if (event.uploaderId.toString() !== req.user.id && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to update this event' });
    }

    event = await Event.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    res.status(200).json({ success: true, data: event });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Check permission: owner or creator_admin
    if (event.uploaderId.toString() !== req.user.id && req.user.role !== 'creator_admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this event' });
    }

    if (event.mediaUrls && event.mediaUrls.length > 0) {
      for (const url of event.mediaUrls) {
        await deleteFromCloudinary(url);
      }
    }

    await event.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
