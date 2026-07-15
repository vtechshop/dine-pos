import { Router, Response } from 'express';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();

router.use(authMiddleware);
// requireAdmin is applied per write-route only — all authenticated roles can read products

// GET all products for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId, isDeleted: false };
    if (req.query.available === 'true') filter.isAvailable = true;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.search) {
      const escaped = (req.query.search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }

    const products = await Product.find(filter)
      .populate('category', 'name color')
      .sort({ name: 1 });
    res.json(products);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET low stock products (stock defined and <= threshold)
router.get('/alerts/low-stock', async (req: AuthRequest, res: Response) => {
  try {
    const threshold = parseInt(req.query.threshold as string) || 5;
    const products = await Product.find({
      hotelId: req.hotelId,
      isDeleted: false,
      stock: { $gt: 0, $lte: threshold },
    }).populate('category', 'name color').sort({ stock: 1 });
    res.json({ products, threshold });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET single product
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, hotelId: req.hotelId })
      .populate('category');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// POST create product — admin only
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const product = new Product({ ...req.body, hotelId: req.hotelId });
    await product.save();
    const populated = await product.populate('category', 'name color');
    logAudit(req, 'product.created', 'product', String((product as any)._id), { name: (product as any).name });
    res.status(201).json(populated);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT update product — admin only
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    ).populate('category', 'name color');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const meta: Record<string, unknown> = { name: (product as any).name };
    if (req.body.price !== undefined) meta.newPrice = (product as any).price;
    logAudit(req, 'product.updated', 'product', req.params.id, meta);
    res.json(product);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE product (soft delete) — admin only
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { isDeleted: true, isAvailable: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    logAudit(req, 'product.deleted', 'product', req.params.id, { name: (product as any).name });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
