const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a school name']
  },
  chairmanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  associationYear: {
    type: String,
    required: [true, 'Please add association year (e.g., 2nd-year)']
  },
  classCoverage: {
    type: String,
    required: [true, 'Please add class coverage (e.g., 8th to 10th)']
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  state: {
    type: String,
    required: [true, 'Please add a state (e.g., Kerala, Tamil Nadu)']
  },
  totalStrength: {
    type: Number,
    default: 0
  },
  mouPdfUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('School', schoolSchema);
