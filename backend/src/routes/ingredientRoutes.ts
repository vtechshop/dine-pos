import { Router, Response } from 'express';
import Ingredient from '../models/Ingredient';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('ingredients'));

// GET all ingredients for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,  0);
    const [ingredients, total] = await Promise.all([
      Ingredient.find({ hotelId: req.hotelId }).sort({ name: 1 }).skip(skip).limit(limit),
      Ingredient.countDocuments({ hotelId: req.hotelId }),
    ]);
    res.json({ ingredients, total, limit, skip });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET low stock ingredients (currentStock <= lowStockThreshold)
router.get('/alerts/low-stock', async (req: AuthRequest, res: Response) => {
  try {
    const ingredients = await Ingredient.find({
      hotelId: req.hotelId,
      $expr: { $lte: ['$currentStock', '$lowStockThreshold'] },
    }).sort({ currentStock: 1 });
    res.json({ ingredients });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create ingredient
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = new Ingredient({ ...req.body, hotelId: req.hotelId });
    await ingredient.save();
    logAudit(req, 'ingredient.created', 'ingredient', String((ingredient as any)._id), { name: (ingredient as any).name });
    res.status(201).json(ingredient);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PUT update ingredient (name, unit, threshold, cost)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = await Ingredient.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    logAudit(req, 'ingredient.updated', 'ingredient', req.params.id, { name: (ingredient as any).name });
    res.json(ingredient);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PATCH restock — add quantity to currentStock
router.patch('/:id/restock', async (req: AuthRequest, res: Response) => {
  try {
    const { quantity } = req.body;
    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ message: 'Valid positive quantity required' });
    }
    const ingredient = await Ingredient.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { $inc: { currentStock: quantity } },
      { new: true }
    );
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    logAudit(req, 'ingredient.restocked', 'ingredient', req.params.id, { name: (ingredient as any).name, quantity });
    res.json(ingredient);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// DELETE ingredient
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = await Ingredient.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    logAudit(req, 'ingredient.deleted', 'ingredient', req.params.id, { name: (ingredient as any).name });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
