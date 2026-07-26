import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import ModifierGroup from '../models/ModifierGroup';
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
      .populate({ path: 'modifierGroups', match: { isDeleted: false } })
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
    const ALLOWED = ['name', 'description', 'price', 'taxPercent', 'category', 'isAvailable', 'isVeg', 'shortCode', 'image', 'stock', 'variants', 'modifierGroups'] as const;
    const update: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
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

// ── Modifier Group assignment routes ──────────────────────────────────────────

// POST /products/:id/modifier-groups — assign a modifier group
router.post('/:id/modifier-groups', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { modifierGroupId } = req.body;
    if (!modifierGroupId || !mongoose.isValidObjectId(modifierGroupId)) {
      return res.status(400).json({ message: 'Valid modifierGroupId is required' });
    }
    const mgId = new mongoose.Types.ObjectId(modifierGroupId);
    const mg = await ModifierGroup.findOne({ _id: mgId, hotelId: req.hotelId, isDeleted: false });
    if (!mg) return res.status(404).json({ message: 'Modifier group not found' });

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { $addToSet: { modifierGroups: mgId } },
      { new: true }
    ).populate('category', 'name color').populate({ path: 'modifierGroups', match: { isDeleted: false } });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    logAudit(req, 'product.modifierGroup.assigned', 'product', req.params.id, { modifierGroupId, modifierGroupName: mg.name });
    res.json(product);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// DELETE /products/:id/modifier-groups/:mgId — remove a modifier group
router.delete('/:id/modifier-groups/:mgId', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mgId)) {
      return res.status(400).json({ message: 'Invalid modifierGroupId' });
    }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { $pull: { modifierGroups: new mongoose.Types.ObjectId(req.params.mgId) } },
      { new: true }
    ).populate('category', 'name color').populate({ path: 'modifierGroups', match: { isDeleted: false } });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    logAudit(req, 'product.modifierGroup.removed', 'product', req.params.id, { modifierGroupId: req.params.mgId });
    res.json(product);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── Variant sub-resource routes ───────────────────────────────────────────────

// POST /products/:id/variants — add a variant
router.post('/:id/variants', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, price } = req.body;
    if (!name || typeof price !== 'number' || price < 0) {
      return res.status(400).json({ message: 'name (string) and price (number ≥ 0) are required' });
    }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { $push: { variants: { name: String(name).trim(), price } } },
      { new: true, runValidators: true }
    ).populate('category', 'name color');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    logAudit(req, 'product.variant.added', 'product', req.params.id, { variantName: name });
    res.status(201).json(product);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT /products/:id/variants/:variantId — update a variant
router.put('/:id/variants/:variantId', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.variantId)) {
      return res.status(400).json({ message: 'Invalid variantId' });
    }
    const setFields: Record<string, unknown> = {};
    if (req.body.name  !== undefined) setFields['variants.$.name']  = String(req.body.name).trim();
    if (req.body.price !== undefined) setFields['variants.$.price'] = Number(req.body.price);
    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ message: 'Provide name or price to update' });
    }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, 'variants._id': new mongoose.Types.ObjectId(req.params.variantId) },
      { $set: setFields },
      { new: true, runValidators: true }
    ).populate('category', 'name color');
    if (!product) return res.status(404).json({ message: 'Product or variant not found' });
    logAudit(req, 'product.variant.updated', 'product', req.params.id, { variantId: req.params.variantId });
    res.json(product);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE /products/:id/variants/:variantId — remove a variant
router.delete('/:id/variants/:variantId', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.variantId)) {
      return res.status(400).json({ message: 'Invalid variantId' });
    }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { $pull: { variants: { _id: new mongoose.Types.ObjectId(req.params.variantId) } } },
      { new: true }
    ).populate('category', 'name color');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    logAudit(req, 'product.variant.deleted', 'product', req.params.id, { variantId: req.params.variantId });
    res.json(product);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
