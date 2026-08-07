import { Router, Response } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

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
router.post('/image', upload.single('image'), (req: AuthRequest, res: Response) => {
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

// POST /api/uploads/placeholder-image — fetch remote image and re-upload to Cloudinary
router.post('/placeholder-image', async (req: AuthRequest, res: Response) => {
  const { sourceUrl } = req.body;
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return res.status(400).json({ message: 'sourceUrl is required' });
  }

  // P0-2: SSRF guard — allow only public HTTPS image URLs
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ message: 'Only HTTPS URLs are allowed' });
    }
    const h = parsed.hostname.toLowerCase();
    const PRIVATE = [
      /^localhost$/, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/, /^0\.0\.0\.0$/,
      /^::ffff:/i,  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 → loopback)
    ];
    if (PRIVATE.some(p => p.test(h))) {
      return res.status(400).json({ message: 'Private or loopback URLs are not allowed' });
    }
  } catch {
    return res.status(400).json({ message: 'Invalid URL' });
  }

  try {
    const fetchResp = await fetch(sourceUrl);
    if (!fetchResp.ok) throw new Error(`Failed to fetch image: ${fetchResp.status}`);
    const contentType = fetchResp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error('URL does not point to an image');
    const contentLength = Number(fetchResp.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024) throw new Error('Remote image exceeds 5 MB size limit');
    const buffer = Buffer.from(await fetchResp.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) throw new Error('Remote image exceeds 5 MB size limit');

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'hotel-pos/products', resource_type: 'image' },
        (error, r) => {
          if (error || !r) reject(error || new Error('Cloudinary upload failed'));
          else resolve(r as { secure_url: string });
        }
      );
      stream.end(buffer);
    });

    return res.json({ url: result.secure_url });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || 'Failed to upload placeholder image' });
  }
});

export default router;
