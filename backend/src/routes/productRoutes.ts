import { Router, Response } from 'express';
import Product from '../models/Product';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// All product routes require auth
router.use(authMiddleware);

// GET all products for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId, isDeleted: false };
    if (req.query.available === 'true') filter.isAvailable = true;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };

    const products = await Product.find(filter)
      .populate('category', 'name color')
      .sort({ name: 1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
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
    res.status(500).json({ message: 'Server error', error });
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
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create product
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const product = new Product({ ...req.body, hotelId: req.hotelId });
    await product.save();
    const populated = await product.populate('category', 'name color');
    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PUT update product
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    ).populate('category', 'name color');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// DELETE product (soft delete — marks isDeleted, keeps data)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { isDeleted: true, isAvailable: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
