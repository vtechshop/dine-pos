import { Router, Response } from 'express';
import Category from '../models/Category';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// All category routes require auth
router.use(authMiddleware);

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

// GET single category
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create category
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const category = new Category({ ...req.body, hotelId: req.hotelId });
    await category.save();
    res.status(201).json(category);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Invalid data' });
  }
});

// PUT update category
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// DELETE category (soft delete)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
