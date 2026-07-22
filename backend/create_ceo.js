const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const dns = require('dns');

dotenv.config();
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

// Edit these before running, or override via env (CEO_NAME / CEO_EMAIL / CEO_PASSWORD).
const ceo = {
  name: process.env.CEO_NAME || 'IECE CEO',
  email: process.env.CEO_EMAIL || 'ceo@iece.org.in',
  password: process.env.CEO_PASSWORD || 'Ceo@2026',
  role: 'ceo',
};

const seedCeo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for CEO Seeding...');

    const existing = await User.findOne({ email: ceo.email });
    if (!existing) {
      await User.create(ceo);
      console.log(`CEO successfully created with email: ${ceo.email}`);
    } else {
      console.log('CEO already exists.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error seeding CEO:', error);
    process.exit(1);
  }
};

seedCeo();
