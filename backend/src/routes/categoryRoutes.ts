import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Category from '../models/Category';
import CategoryConfig from '../models/CategoryConfig';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();

router.use(authMiddleware);
// requireAdmin is applied per write-route only — all authenticated roles can read categories

// GET all categories for this hotel
// For multiBranch branches: fetches org categories and applies CategoryConfig overlay.
// Default semantics: no config row = category visible; enabled:false = hidden.
router.get('/', async (req: AuthRequest, res: Response) => {
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
      res.json(visible);
      return;
    }

    const categories = await Category.find({
      hotelId: req.hotelId,
      isActive: true,
      isDeleted: false,
    }).sort({ sortOrder: 1 });
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

// POST create category — admin only
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const category = new Category({ ...req.body, hotelId: req.hotelId });
    await category.save();
    logAudit(req, 'category.created', 'category', String((category as any)._id), { name: (category as any).name });
    res.status(201).json(category);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT update category — admin only
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, color, icon, sortOrder, isActive } = req.body;
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
    res.json(category);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE category (soft delete) — admin only
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    logAudit(req, 'category.deleted', 'category', req.params.id, { name: (category as any).name });
    res.json({ message: 'Category deleted' });
  } catch (error) {
    sendError(res, 500, 'Failed to delete category', error);
  }
});

export default router;
