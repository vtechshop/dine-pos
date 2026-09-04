import { Router, Response }   from 'express';
import multer                  from 'multer';
import mongoose                from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature }      from '../middleware/requireFeature';
import { makeRateLimiter }     from '../utils/rateLimiter';
import { ipKeyGenerator }      from 'express-rate-limit';
import { logAudit }            from '../utils/audit';
import { getAIProvider, ExtractedCategory } from '../services/ai';
import Category                from '../models/Category';
import Product                 from '../models/Product';
import ModifierGroup           from '../models/ModifierGroup';
import { logger }              from '../utils/logger';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('ai'));

// ── Hotel-scoped rate limit for /extract ──────────────────────────────────────
// Server.ts already applies an IP-based limit (10/min) to all /api/ai-menu.
// This adds a hotel-scoped limit (5/min) specifically on the extraction endpoint
// so a single hotel cannot exhaust the shared GEMINI_API_KEY quota.
// keyGenerator runs after authMiddleware, so req.hotelId is already set.
const extractRateLimit = makeRateLimiter({
  windowMs:     60_000,
  max:          5,
  keyGenerator: (req) => `ai-extract:${(req as AuthRequest).hotelId ?? ipKeyGenerator(req.ip ?? '')}`,
  handler:      (_req, res) =>
    res.status(429).json({
      message: 'AI extraction rate limit exceeded. Maximum 5 menu scans per minute per hotel.',
    }),
  skip: () => process.env.NODE_ENV === 'test',
});

// ── Multer — in-memory only, never written to disk ────────────────────────────
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, PNG, and JPG files are accepted'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Import types ──────────────────────────────────────────────────────────────

interface ImportVariant {
  name:  string;
  price: number;
}

interface ImportModifierOption {
  name:  string;
  price: number;
}

interface ImportModifierGroup {
  name:          string;
  required:      boolean;
  selectionType: 'single' | 'multi';
  options:       ImportModifierOption[];
}

interface ImportProduct {
  name:            string;
  price:           number | null;
  variants:        ImportVariant[];
  modifierGroups:  ImportModifierGroup[];
  veg:             boolean;
  gst:             number | null;
  hsnCode:         string;
  shortCode:       string;
  description:     string;
  duplicateAction?: 'skip' | 'overwrite' | 'copy';
}

interface ImportCategory {
  name:     string;
  products: ImportProduct[];
}

interface ImportBody {
  categories: ImportCategory[];
}

export interface ImportResults {
  categoriesCreated:     number;
  productsCreated:       number;
  productsOverwritten:   number;
  productsSkipped:       number;
  modifierGroupsCreated: number;
  errors:                Array<{ name: string; reason: string }>;
}

// ── Pre-validation — runs before any DB operation ─────────────────────────────
// Invalid items are collected as errors and skipped; the transaction covers
// only the validated set. This prevents orphaned DB state for format errors
// while keeping per-item error reporting intact.

function preValidate(categories: ImportCategory[]): {
  valid:  ImportCategory[];
  errors: Array<{ name: string; reason: string }>;
} {
  const errors: Array<{ name: string; reason: string }> = [];
  const valid:  ImportCategory[] = [];

  for (const cat of categories) {
    if (!cat.name?.trim()) {
      errors.push({ name: '(unnamed)', reason: 'Category name is required' });
      continue;
    }

    const validProducts: ImportProduct[] = [];

    for (const prod of cat.products ?? []) {
      if (!prod.name?.trim()) {
        errors.push({ name: '(unnamed product)', reason: 'Product name is required' });
        continue;
      }

      if (prod.price !== null && prod.price !== undefined && (prod.price < 0 || prod.price > 50_000)) {
        errors.push({ name: prod.name, reason: 'Base price must be between 0 and ₹50,000' });
        continue;
      }

      if (
        prod.gst !== null &&
        prod.gst !== undefined &&
        (prod.gst < 0 || prod.gst > 100)
      ) {
        errors.push({ name: prod.name, reason: `Invalid GST value: ${prod.gst}` });
        continue;
      }

      let skip = false;

      for (const v of prod.variants ?? []) {
        if (!v.name?.trim()) {
          errors.push({ name: prod.name, reason: 'A variant is missing a name' });
          skip = true; break;
        }
        if (typeof v.price !== 'number' || v.price < 0 || v.price > 50_000) {
          errors.push({ name: prod.name, reason: `Variant "${v.name}" has invalid price` });
          skip = true; break;
        }
      }
      if (skip) continue;

      for (const mg of prod.modifierGroups ?? []) {
        if (!mg.name?.trim()) {
          errors.push({ name: prod.name, reason: 'A modifier group is missing a name' });
          skip = true; break;
        }
        for (const opt of mg.options ?? []) {
          if (!opt.name?.trim()) {
            errors.push({ name: prod.name, reason: `Modifier group "${mg.name}" has an option with no name` });
            skip = true; break;
          }
          if (typeof opt.price !== 'number' || opt.price < 0 || opt.price > 50_000) {
            errors.push({ name: prod.name, reason: `Modifier option "${opt.name}" has invalid price` });
            skip = true; break;
          }
        }
        if (skip) break;
      }
      if (skip) continue;

      validProducts.push(prod);
    }

    // Only include category if it has at least one valid product
    if (validProducts.length > 0) {
      valid.push({ ...cat, products: validProducts });
    }
  }

  return { valid, errors };
}

// ── Variant helpers ───────────────────────────────────────────────────────────

function buildVariants(
  variants?: ImportVariant[],
): Array<{ name: string; price: number }> {
  return (variants ?? [])
    .filter(v => v.name?.trim() && typeof v.price === 'number' && v.price >= 0)
    .map(v => ({ name: v.name.trim(), price: v.price }));
}

function computeBasePrice(
  base:     number | null | undefined,
  variants?: ImportVariant[],
): number {
  const built = buildVariants(variants);
  if (built.length > 0) return Math.min(...built.map(v => v.price));
  return base ?? 0;
}

// ── Modifier group resolution (within a transaction) ─────────────────────────
// Existing hotel modifier groups with the same name are reused as-is to avoid
// duplicating shared add-on menus (e.g. a shared "Add-ons" group).
// New groups are created within the transaction.
// A per-import Map caches found/created IDs so the same group name is not
// looked up or created twice within one import.

async function resolveModifierGroups(
  hotelObjectId: mongoose.Types.ObjectId,
  groups:        ImportModifierGroup[],
  cache:         Map<string, mongoose.Types.ObjectId>,
  session:       mongoose.ClientSession,
  results:       ImportResults,
): Promise<mongoose.Types.ObjectId[]> {
  const ids: mongoose.Types.ObjectId[] = [];

  for (const mg of groups) {
    if (!mg.name?.trim() || !mg.options?.length) continue;
    const key = mg.name.trim().toLowerCase();

    let mgId = cache.get(key);
    if (!mgId) {
      const existing = await ModifierGroup.findOne({
        hotelId:   hotelObjectId,
        name:      { $regex: new RegExp(`^${escapeRegex(mg.name.trim())}$`, 'i') },
        isDeleted: false,
      }).session(session);

      if (existing) {
        mgId = existing._id as mongoose.Types.ObjectId;
      } else {
        const [created] = await ModifierGroup.create(
          [{
            hotelId:       hotelObjectId,
            name:          mg.name.trim(),
            isRequired:    mg.required,
            selectionType: mg.selectionType,
            minSelections: mg.required ? 1 : 0,
            maxSelections: mg.selectionType === 'single' ? 1 : mg.options.length,
            options: mg.options.map((opt, i) => ({
              name:         opt.name.trim(),
              price:        opt.price,
              isActive:     true,
              displayOrder: i,
            })),
            isActive:  true,
            isDeleted: false,
          }],
          { session },
        );
        mgId = created._id as mongoose.Types.ObjectId;
        results.modifierGroupsCreated++;
      }
      cache.set(key, mgId!);
    }

    ids.push(mgId!);
  }

  return ids;
}

// ── POST /api/ai-menu/extract ─────────────────────────────────────────────────
// Hotel-scoped rate limit (5/min) applied before multer.
// Files < 3 MB → inline base64; ≥ 3 MB → Gemini File API.
router.post(
  '/extract',
  extractRateLimit,
  upload.single('menu'),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ message: 'No file uploaded. Send a PDF, PNG, or JPG under the "menu" field.' });
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
      return res
        .status(503)
        .json({ message: 'AI service is not configured. Set GEMINI_API_KEY.' });
    }

    try {
      const result = await provider.extractMenu(buffer, mimetype);
      const categoriesCount = result.categories.length;
      const productsCount   = result.categories.reduce((s, c) => s + c.products.length, 0);

      logger.info('[AI Menu] extraction complete', {
        hotelId:    req.hotelId,
        categories: categoriesCount,
        products:   productsCount,
        provider:   provider.providerName,
        viaFileAPI: size > 3 * 1024 * 1024,
      });

      // Audit — metadata only, no file contents or Gemini prompts
      logAudit(req, 'ai_menu.extract', 'ai_menu', '', {
        filename:           originalname,
        bytes:              size,
        mimeType:           mimetype,
        categoriesExtracted: categoriesCount,
        productsExtracted:  productsCount,
        provider:           provider.providerName,
      });

      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AI Menu] extraction failed', { hotelId: req.hotelId, err: msg });
      return res.status(502).json({ message: `AI extraction failed: ${msg}` });
    }
  },
);

// ── POST /api/ai-menu/check-duplicates ───────────────────────────────────────
// Cross-category: returns any existing product that matches any import name,
// regardless of which category the existing product is in.
router.post('/check-duplicates', async (req: AuthRequest, res: Response) => {
  const { categories } = req.body as { categories: ExtractedCategory[] };
  if (!Array.isArray(categories)) {
    return res.status(400).json({ message: 'categories array required' });
  }

  const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId);

  // Collect unique product names from the import payload
  const entries: Array<{ name: string; categoryName: string }> = [];
  for (const cat of categories) {
    for (const prod of cat.products ?? []) {
      if (prod.name?.trim()) entries.push({ name: prod.name.trim(), categoryName: cat.name });
    }
  }
  if (entries.length === 0) return res.json({ duplicates: [] });

  // One query for all names across all categories
  const nameFilters = entries.map(e => ({
    name: { $regex: new RegExp(`^${escapeRegex(e.name)}$`, 'i') },
  }));

  const existingProducts = await Product.find({
    hotelId:   hotelObjectId,
    isDeleted: false,
    $or:       nameFilters,
  }).populate<{ category: { name: string } }>('category', 'name').lean();

  const existingByName = new Map<string, string>();
  for (const ep of existingProducts) {
    existingByName.set(ep.name.toLowerCase(), ep.category?.name ?? '');
  }

  const duplicates: Array<{
    productName: string;
    categoryName: string;
    existingCategoryName: string;
  }> = [];

  for (const entry of entries) {
    const existingCat = existingByName.get(entry.name.toLowerCase());
    if (existingCat !== undefined) {
      duplicates.push({
        productName:          entry.name,
        categoryName:         entry.categoryName,
        existingCategoryName: existingCat,
      });
    }
  }

  return res.json({ duplicates });
});

// ── POST /api/ai-menu/import ──────────────────────────────────────────────────
// Transactional: all category/product/modifier-group writes are atomic.
// If any write fails at the DB level, the entire import is rolled back.
// Pre-validation errors (bad price, missing name, etc.) are collected before
// the transaction and reported without touching the DB.
router.post('/import', async (req: AuthRequest, res: Response) => {
  const { categories } = req.body as ImportBody;

  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ message: 'categories array is required and must not be empty' });
  }

  // A-06: prevent an AI response from importing an unreasonably large menu in one transaction.
  // 500 products covers the largest real restaurant menus; beyond that the transaction becomes
  // too expensive and the AI response is almost certainly malformed.
  const AI_MENU_IMPORT_CAP = 500;
  const totalProducts = categories.reduce(
    (sum: number, cat: any) => sum + (Array.isArray(cat.products) ? cat.products.length : 0),
    0,
  );
  if (totalProducts > AI_MENU_IMPORT_CAP) {
    return res.status(400).json({
      message: `AI menu import is capped at ${AI_MENU_IMPORT_CAP} products. The response contained ${totalProducts}. Please reduce the import batch size.`,
    });
  }

  const { valid, errors: preErrors } = preValidate(categories);

  if (valid.length === 0) {
    return res.status(400).json({
      message: 'No valid products to import after validation.',
      results: {
        categoriesCreated:     0,
        productsCreated:       0,
        productsOverwritten:   0,
        productsSkipped:       0,
        modifierGroupsCreated: 0,
        errors:                preErrors,
      } as ImportResults,
    });
  }

  const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId!);

  // txResults is reset inside withTransaction so retries start clean
  let txResults: ImportResults = {
    categoriesCreated:     0,
    productsCreated:       0,
    productsOverwritten:   0,
    productsSkipped:       0,
    modifierGroupsCreated: 0,
    errors:                [...preErrors],
  };

  const session = await mongoose.startSession();
  let txError: unknown = null;

  try {
    await session.withTransaction(async () => {
      txResults = {
        categoriesCreated:     0,
        productsCreated:       0,
        productsOverwritten:   0,
        productsSkipped:       0,
        modifierGroupsCreated: 0,
        errors:                [...preErrors],
      };

      // Modifier group cache — shared across all categories in this import
      const mgCache = new Map<string, mongoose.Types.ObjectId>();

      for (const cat of valid) {
        // ── Find or create category ─────────────────────────────────────────
        let categoryDoc = await Category.findOne({
          hotelId:   hotelObjectId,
          name:      { $regex: new RegExp(`^${escapeRegex(cat.name.trim())}$`, 'i') },
          isDeleted: false,
        }).session(session);

        if (!categoryDoc) {
          const [created] = await Category.create(
            [{
              hotelId:   hotelObjectId,
              name:      cat.name.trim(),
              icon:      'restaurant',
              color:     '#FF6B35',
              isActive:  true,
              sortOrder: 0,
            }],
            { session },
          );
          categoryDoc = created;
          txResults.categoriesCreated++;
        }

        // ── Process products ────────────────────────────────────────────────
        for (const prod of cat.products) {
          const existing = await Product.findOne({
            hotelId:   hotelObjectId,
            category:  categoryDoc._id,
            name:      { $regex: new RegExp(`^${escapeRegex(prod.name.trim())}$`, 'i') },
            isDeleted: false,
          }).session(session);

          if (existing) {
            const action = prod.duplicateAction ?? 'skip';

            if (action === 'skip') {
              txResults.productsSkipped++;
              continue;
            }

            if (action === 'overwrite') {
              const variants = buildVariants(prod.variants);
              const updates: Record<string, unknown> = {
                price:       computeBasePrice(prod.price, prod.variants),
                isVeg:       prod.veg,
                description: prod.description || existing.description,
                taxPercent:  prod.gst ?? existing.taxPercent,
              };
              if (variants.length)  updates.variants  = variants;
              if (prod.hsnCode)     updates.hsnCode   = prod.hsnCode;
              if (prod.shortCode)   updates.shortCode = prod.shortCode;
              await Product.updateOne({ _id: existing._id }, { $set: updates }, { session });
              txResults.productsOverwritten++;
              continue;
            }

            // 'copy' — rename and fall through to create
            prod.name = `${prod.name.trim()} (Copy)`;
          }

          // ── Resolve modifier groups ─────────────────────────────────────
          const mgIds = await resolveModifierGroups(
            hotelObjectId, prod.modifierGroups ?? [], mgCache, session, txResults,
          );

          const variants  = buildVariants(prod.variants);
          const basePrice = computeBasePrice(prod.price, prod.variants);

          await Product.create(
            [{
              hotelId:        hotelObjectId,
              category:       categoryDoc._id,
              name:           prod.name.trim(),
              price:          basePrice,
              isVeg:          prod.veg,
              description:    prod.description || '',
              taxPercent:     prod.gst ?? 5,
              hsnCode:        prod.hsnCode  || '',
              shortCode:      prod.shortCode || '',
              isAvailable:    true,
              isDeleted:      false,
              variants,
              modifierGroups: mgIds,
            }],
            { session },
          );
          txResults.productsCreated++;
        }
      }
    });
  } catch (err: unknown) {
    txError = err;
  } finally {
    session.endSession();
  }

  if (txError) {
    const msg = txError instanceof Error ? txError.message : String(txError);
    logger.error('[AI Menu] import transaction aborted — full rollback', {
      hotelId: req.hotelId,
      err: msg,
    });
    return res.status(500).json({
      message: `Import failed and was fully rolled back: ${msg}`,
    });
  }

  // Audit after successful commit — metadata only, no product names or raw data
  logAudit(req, 'ai_menu.import', 'ai_menu', '', {
    categoriesCreated:     txResults.categoriesCreated,
    productsCreated:       txResults.productsCreated,
    productsOverwritten:   txResults.productsOverwritten,
    productsSkipped:       txResults.productsSkipped,
    modifierGroupsCreated: txResults.modifierGroupsCreated,
    validationErrors:      preErrors.length,
  });

  logger.info('[AI Menu] import complete', { hotelId: req.hotelId, results: txResults });
  return res.json({ success: true, results: txResults });
});

export default router;
