const mongoose = require('mongoose');
const decisionSchema = require('./decisionSchema');

const mediaSchema = new mongoose.Schema({
  uploaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  imageUrl: {
    type: String,
    required: [true, 'Please add an image url']
  },
  description: {
    type: String,
    required: [true, 'Please add a description']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  // People this banner is deliberately NOT shown to.
  //
  // A banner is public by default — an empty list means everybody sees it, which
  // is what every banner uploaded before this field existed does. Naming anyone
  // here (any login, any role) takes the banner off THEIR Home carousel only;
  // nothing else about it changes and no one is told.
  //
  // The filtering happens on the server, in getMedia, so a client that never
  // heard of this field still cannot show a banner to someone excluded from it.
  // The Admin's own Banners tab asks for the unfiltered list explicitly
  // (`?scope=manage`) so the list they manage is always the whole list.
  hiddenFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Snapshot of WHO decided this and what they did — the one field every screen
  // reads to render "Approved by". Shown to the Admin and CEO only.
  decidedBy: {
    type: decisionSchema,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Media', mediaSchema);
