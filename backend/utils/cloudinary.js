const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary with credentials from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer Storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Automatically determine resource type
    let resource_type = 'auto';
    let folder = 'iece_uploads';

    if (file.mimetype === 'application/pdf') {
      resource_type = 'raw'; // Cloudinary treats PDFs as raw unless we explicitly want them as images
      folder = 'iece_mous';
    } else if (file.mimetype.startsWith('image/')) {
      resource_type = 'image';
      folder = 'iece_images';
    } else if (file.mimetype.includes('wordprocessingml.document') || file.mimetype.includes('msword')) {
      resource_type = 'raw';
      folder = 'iece_mous';
    }

    return {
      folder: folder,
      resource_type: resource_type,
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  }
});

const upload = multer({ storage: storage });

const deleteFromCloudinary = async (fileUrl) => {
  if (!fileUrl || !fileUrl.includes('cloudinary.com')) return false;
  
  try {
    const pathname = new URL(fileUrl).pathname;
    // Extract resource_type (image, video, raw)
    const resourceType = pathname.split('/upload/')[0].split('/').pop();
    
    // Extract public_id
    let afterUpload = pathname.split('/upload/')[1];
    if (afterUpload.match(/^v\d+\//)) {
      afterUpload = afterUpload.replace(/^v\d+\//, '');
    }
    
    // Remove extension for images and videos, but Cloudinary raw files might need it
    // However, our upload config manually stripped the extension for ALL files.
    let publicId = afterUpload;
    const lastDotIndex = publicId.lastIndexOf('.');
    if (lastDotIndex !== -1 && resourceType !== 'raw') {
      publicId = publicId.substring(0, lastDotIndex);
    } else if (lastDotIndex !== -1 && resourceType === 'raw') {
      // For raw files, Cloudinary sometimes requires the extension in destroy.
      // We will try without extension first, since our config stripped it.
      publicId = publicId.substring(0, lastDotIndex);
    }

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    console.log(`Cloudinary deletion [${publicId}]:`, result);
    return result;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    return false;
  }
};

module.exports = {
  cloudinary,
  upload,
  deleteFromCloudinary
};
