const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const dns = require('dns');

dotenv.config();
if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const admins = [
  {
    name: 'IECE Trainer',
    email: 'iece.trainer@gmail.com',
    password: 'iecetrainer@2017',
    role: 'trainer',
  },
  {
    name: 'School Chairman',
    email: 'school.chairman@gmail.com',
    password: 'schoolchairman@2017',
    role: 'chairman',
  },
  {
    name: 'IECE Team Leader',
    email: 'iece.teamleader@gmail.com',
    password: 'iece.teamleader@2017',
    role: 'team_leader',
  },
];

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

const seedAdmins = async () => {
  await connectDB();
  try {
    for (const admin of admins) {
      const existingUser = await User.findOne({ email: admin.email });
      if (!existingUser) {
        await User.create(admin);
        console.log(`Created ${admin.role}: ${admin.email}`);
      } else {
        console.log(`User already exists: ${admin.email}`);
      }
    }
    console.log('Done.');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedAdmins();
