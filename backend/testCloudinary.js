require('dotenv').config();
const { cloudinary } = require('./utils/cloudinary');

console.log('Cloud name:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('API Key:', process.env.CLOUDINARY_API_KEY);
console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? '***' : 'missing');

cloudinary.api.ping((error, result) => {
  if (error) {
    console.error('Cloudinary ping error:', error);
  } else {
    console.log('Cloudinary ping success:', result);
  }
});
