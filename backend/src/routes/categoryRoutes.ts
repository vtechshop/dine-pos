import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Category from '../models/Category';
import CategoryConfig from '../models/CategoryConfig';
import Hotel from '../models/Hotel';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';
import { menuCacheGet, menuCacheSet, menuCacheDel } from '../utils/menuCache';

const router = Router();

router.use(authMiddleware);

const categoryCacheKey     = (hotelId: string) => `categories:${hotelId}`;
const invalidateCategoryCache = (hotelId: string) => menuCacheDel(categoryCacheKey(hotelId));

// GET all categories for this hotel
// For multiBranch branches: fetches org categories and applies CategoryConfig overlay.
// Default semantics: no config row = category visible; enabled:false = hidden.
router.get('/', async (req: AuthRequest, res: Response) => {
  const cacheKey = categoryCacheKey(req.hotelId!);
  const cached = menuCacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Check if caller is a multiBranch branch
    const hotel = await Hotel.findById(req.hotelId)
      .select('parentHotelId features')
      .lean();

    if (hotel?.parentHotelId && hotel.features?.multiBranch) {
      const orgHotelId   = hotel.parentHotelId;
      const branchObjId  = new mongoose.Types.ObjectId(req.hotelId!);

      // Fetch org categories + disabled configs for this branch in parallel
      const [categories, disabledConfigs] = await Promise.all([
        Category.find({ hotelId: orgHotelId, isActive: true, isDeleted: false })
          .sort({ sortOrder: 1 })
          .lean(),
        CategoryConfig.find({ orgHotelId, branchHotelId: branchObjId, enabled: false })
          .select('categoryId')
          .lean(),
      ]);

      const disabledIds = new Set(disabledConfigs.map(c => c.categoryId.toString()));
      const visible = categories.filter(cat => !disabledIds.has(cat._id.toString()));
      menuCacheSet(cacheKey, visible);
      res.json(visible);
      return;
    }

    const categories = await Category.find({
      hotelId: req.hotelId,
      isActive: true,
      isDeleted: false,
    }).sort({ sortOrder: 1 }).lean();

    menuCacheSet(cacheKey, categories);
    res.json(categories);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch categories', error);
  }
});

// GET single category — all authenticated roles
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch category', error);
  }
});

// Phase 5 · Batch 7 (P4-CATALOG-06/07): a live category with the same name (case and spaces
// ignored) is refused with a clear message; a DELETED one with that exact name is brought back
// (the unique {hotelId, name} index also covers deleted rows, so a new row cannot be inserted).
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameName = (name: string) => new RegExp(`^\\s*${escapeRx(name.trim()).replace(/\s+/g, '\\s+')}\\s*$`, 'i');
const nameTaken = (hotelId: string, name: string, exceptId?: string) => Category.exists({
  hotelId, isDeleted: false, name: sameName(name), ...(exceptId ? { _id: { $ne: exceptId } } : {}),
});
const duplicateName = (res: Response, name: string) => res.status(409).json({
  message: `A category named "${name.trim()}" already exists`, code: 'DUPLICATE_NAME',
});

// POST create category — admin only
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, color, icon, sortOrder, isActive } = req.body ?? {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return res.status(400).json({ message: 'Category name is required' });
    if (await nameTaken(req.hotelId!, cleanName)) return duplicateName(res, cleanName);
    const fields: Record<string, unknown> = { name: cleanName };
    if (color     !== undefined) fields.color     = color;
    if (icon      !== undefined) fields.icon      = icon;
    if (sortOrder !== undefined) fields.sortOrder = sortOrder;
    fields.isActive = isActive !== undefined ? isActive : true;

    const deleted = await Category.findOne({ hotelId: req.hotelId, name: cleanName, isDeleted: true });
    if (deleted) {
      deleted.set({ ...fields, isDeleted: false });
      await deleted.save();
      logAudit(req, 'category.restored', 'category', String(deleted._id), { name: cleanName });
      invalidateCategoryCache(req.hotelId!);
      return res.status(201).json(deleted);
    }

    const category = new Category({ ...fields, hotelId: req.hotelId });
    await category.save();
    logAudit(req, 'category.created', 'category', String((category as any)._id), { name: (category as any).name });
    invalidateCategoryCache(req.hotelId!);
    res.status(201).json(category);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT update category — admin only
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, color, icon, sortOrder, isActive } = req.body;
    if (typeof name === 'string' && name.trim() && await nameTaken(req.hotelId!, name, req.params.id)) {
      return duplicateName(res, name);
    }
    const update: Record<string, unknown> = {};
    if (name      !== undefined) update.name      = name;
    if (color     !== undefined) update.color     = color;
    if (icon      !== undefined) update.icon      = icon;
    if (sortOrder !== undefined) update.sortOrder = sortOrder;
    if (isActive  !== undefined) update.isActive  = isActive;
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    logAudit(req, 'category.updated', 'category', req.params.id, { name: (category as any).name });
    invalidateCategoryCache(req.hotelId!);
    res.json(category);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE category (soft delete) — admin only
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found' });
    // Phase 5 · Batch 7 (P4-CATALOG-05): as the confirm text says, products must be moved first —
    // otherwise they vanish from the POS while still pointing at the deleted category.
    const live = await Product.countDocuments({ hotelId: req.hotelId, category: req.params.id, isDeleted: { $ne: true } });
    if (live > 0) {
      const them = live === 1 ? 'it' : 'them';
      return res.status(409).json({
        message: `This category still has ${live} product${live === 1 ? '' : 's'}. Move ${them} to another category or delete ${them} first.`,
        code: 'CATEGORY_HAS_PRODUCTS',
      });
    }
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: { $ne: true } },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    logAudit(req, 'category.deleted', 'category', req.params.id, { name: (category as any).name });
    invalidateCategoryCache(req.hotelId!);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    sendError(res, 500, 'Failed to delete category', error);
  }
});

export default router;
