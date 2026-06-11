import { Router, Response } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Keep file in memory — no local disk write
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// POST /api/uploads/image — returns { url: 'https://res.cloudinary.com/...' }
router.post('/image', authMiddleware, upload.single('image'), (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ message: 'No image file provided' });

  const stream = cloudinary.uploader.upload_stream(
    { folder: 'hotel-pos/products', resource_type: 'image' },
    (error, result) => {
      if (error || !result) {
        return res.status(500).json({ message: 'Cloudinary upload failed', error: error?.message });
      }
      return res.json({ url: result.secure_url });
    }
  );

  stream.end(req.file.buffer);
});

export default router;
