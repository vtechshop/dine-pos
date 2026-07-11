import { Router, Response } from 'express';
import Category from '../models/Category';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

router.use(authMiddleware);
// requireAdmin is applied per write-route only — all authenticated roles can read categories

// GET all categories for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await Category.find({
      hotelId: req.hotelId,
      isActive: true,
      isDeleted: false,
    }).sort({ sortOrder: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET single category — all authenticated roles
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create category — admin only
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const category = new Category({ ...req.body, hotelId: req.hotelId });
    await category.save();
    logAudit(req, 'category.created', 'category', String((category as any)._id), { name: (category as any).name });
    res.status(201).json(category);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Invalid data' });
  }
});

// PUT update category — admin only
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    logAudit(req, 'category.updated', 'category', req.params.id, { name: (category as any).name });
    res.json(category);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
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
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
