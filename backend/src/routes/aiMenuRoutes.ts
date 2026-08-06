import { Router, Response }   from 'express';
import multer                  from 'multer';
import mongoose                from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { getAIProvider, ExtractedCategory }          from '../services/ai';
import Category                from '../models/Category';
import Product                 from '../models/Product';
import { logger }              from '../utils/logger';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── Multer — in-memory, deleted after use ──────────────────────────────────────
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, PNG, and JPG files are accepted'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── POST /api/ai-menu/extract ─────────────────────────────────────────────────
// Accepts: multipart/form-data  field: "menu"
// Returns: MenuExtractionResult JSON
router.post('/extract', upload.single('menu'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded. Send a PDF, PNG, or JPG under the "menu" field.' });
  }

  const { buffer, mimetype, originalname, size } = req.file;

  logger.info('[AI Menu] extract requested', {
    hotelId: req.hotelId,
    filename: originalname,
    mimetype,
    bytes: size,
  });

  let provider;
  try {
    provider = await getAIProvider();
  } catch {
    return res.status(503).json({ message: 'AI service is not configured. Set GEMINI_API_KEY.' });
  }

  try {
    const result = await provider.extractMenu(buffer, mimetype);
    logger.info('[AI Menu] extraction complete', {
      hotelId:    req.hotelId,
      categories: result.categories.length,
      products:   result.categories.reduce((s, c) => s + c.products.length, 0),
      provider:   provider.providerName,
    });
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AI Menu] extraction failed', { hotelId: req.hotelId, err: msg });
    return res.status(502).json({ message: `AI extraction failed: ${msg}` });
  }
});

// ── Import types ───────────────────────────────────────────────────────────────

interface ImportProduct {
  name:             string;
  price:            number | null;
  variant:          string;
  veg:              boolean;
  gst:              number | null;
  description:      string;
  duplicateAction?: 'skip' | 'overwrite' | 'copy';
}

interface ImportCategory {
  name:     string;
  products: ImportProduct[];
}

interface ImportBody {
  categories: ImportCategory[];
}

// ── POST /api/ai-menu/import ──────────────────────────────────────────────────
// Body: { categories: ImportCategory[] }
// Returns: { created, skipped, overwritten, errors }
router.post('/import', async (req: AuthRequest, res: Response) => {
  const { categories } = req.body as ImportBody;

  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ message: 'categories array is required and must not be empty' });
  }

  const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId);
  const results = {
    categoriesCreated:  0,
    productsCreated:    0,
    productsOverwritten: 0,
    productsSkipped:    0,
    errors:             [] as { name: string; reason: string }[],
  };

  for (const cat of categories) {
    if (!cat.name?.trim()) continue;

    // ── Find or create category (case-insensitive match) ──────────────────────
    let categoryDoc = await Category.findOne({
      hotelId: hotelObjectId,
      name:    { $regex: new RegExp(`^${escapeRegex(cat.name.trim())}$`, 'i') },
      isDeleted: false,
    });

    if (!categoryDoc) {
      try {
        categoryDoc = await Category.create({
          hotelId:   hotelObjectId,
          name:      cat.name.trim(),
          icon:      'restaurant',
          color:     '#FF6B35',
          isActive:  true,
          sortOrder: 0,
        });
        results.categoriesCreated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push({ name: cat.name, reason: `Category create failed: ${msg}` });
        continue;
      }
    }

    // ── Process each product ──────────────────────────────────────────────────
    for (const prod of cat.products) {
      if (!prod.name?.trim()) continue;

      const existing = await Product.findOne({
        hotelId:   hotelObjectId,
        category:  categoryDoc._id,
        name:      { $regex: new RegExp(`^${escapeRegex(prod.name.trim())}$`, 'i') },
        isDeleted: false,
      });

      if (existing) {
        const action = prod.duplicateAction ?? 'skip';

        if (action === 'skip') {
          results.productsSkipped++;
          continue;
        }

        if (action === 'overwrite') {
          try {
            await Product.updateOne(
              { _id: existing._id },
              {
                $set: {
                  price:       prod.price ?? existing.price,
                  isVeg:       prod.veg,
                  description: prod.description || existing.description,
                  taxPercent:  prod.gst ?? existing.taxPercent,
                },
              },
            );
            results.productsOverwritten++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.errors.push({ name: prod.name, reason: `Overwrite failed: ${msg}` });
          }
          continue;
        }

        // action === 'copy' — fall through to create with suffix
        prod.name = `${prod.name.trim()} (Copy)`;
      }

      // Create new product
      try {
        await Product.create({
          hotelId:     hotelObjectId,
          category:    categoryDoc._id,
          name:        prod.name.trim(),
          price:       prod.price ?? 0,
          isVeg:       prod.veg,
          description: prod.description || '',
          taxPercent:  prod.gst ?? 5,
          isAvailable: true,
          isDeleted:   false,
        });
        results.productsCreated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push({ name: prod.name, reason: `Create failed: ${msg}` });
      }
    }
  }

  logger.info('[AI Menu] import complete', { hotelId: req.hotelId, results });
  return res.json({ success: true, results });
});

// ── POST /api/ai-menu/check-duplicates ───────────────────────────────────────
// Body: { categories: ExtractedCategory[] }
// Returns: { duplicates: string[] } — product names that already exist
router.post('/check-duplicates', async (req: AuthRequest, res: Response) => {
  const { categories } = req.body as { categories: ExtractedCategory[] };
  if (!Array.isArray(categories)) {
    return res.status(400).json({ message: 'categories array required' });
  }

  const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId);
  const duplicates: Array<{ productName: string; categoryName: string }> = [];

  for (const cat of categories) {
    const catDoc = await Category.findOne({
      hotelId:   hotelObjectId,
      name:      { $regex: new RegExp(`^${escapeRegex(cat.name.trim())}$`, 'i') },
      isDeleted: false,
    });
    if (!catDoc) continue;

    for (const prod of cat.products) {
      const exists = await Product.exists({
        hotelId:   hotelObjectId,
        category:  catDoc._id,
        name:      { $regex: new RegExp(`^${escapeRegex(prod.name.trim())}$`, 'i') },
        isDeleted: false,
      });
      if (exists) duplicates.push({ productName: prod.name, categoryName: cat.name });
    }
  }

  return res.json({ duplicates });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default router;
