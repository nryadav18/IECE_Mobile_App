const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const dns = require('dns');

dotenv.config();
if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const creatorAdmin = {
  name: 'Creator Admin',
  email: 'creator@iece.com',
  password: 'Creator@2017',
  role: 'creator_admin',
};

const seedCreatorAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for Creator Admin Seeding...');

    const existingAdmin = await User.findOne({ email: creatorAdmin.email });
    
    if (!existingAdmin) {
      await User.create(creatorAdmin);
      console.log(`Creator Admin successfully created with email: ${creatorAdmin.email}`);
    } else {
      console.log('Creator Admin already exists.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error seeding Creator Admin:', error);
    process.exit(1);
  }
};

seedCreatorAdmin();
