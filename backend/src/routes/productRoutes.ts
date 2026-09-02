import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Product from '../models/Product';
import Ingredient from '../models/Ingredient';
import ModifierGroup from '../models/ModifierGroup';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

// Simple in-memory rate limiter for AI image generation (5 req/hotel/minute)
const _imgGenBucket = new Map<string, { count: number; resetAt: number }>();
function checkImgGenRate(hotelId: string): boolean {
  const now = Date.now();
  const entry = _imgGenBucket.get(hotelId);
  if (!entry || entry.resetAt < now) {
    _imgGenBucket.set(hotelId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

const router = Router();

router.use(authMiddleware);
// requireAdmin is applied per write-route only — all authenticated roles can read products

// GET all products for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId, isDeleted: false };
    if (req.query.available === 'true') filter.isAvailable = true;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.kitchenStation) filter.kitchenStation = req.query.kitchenStation;
    if (req.query.search) {
      const escaped = (req.query.search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }

    const products = await Product.find(filter)
      .populate('category', 'name color')
      .populate('kitchenStation', 'name isActive')
      .populate({ path: 'modifierGroups', match: { isDeleted: false } })
      .populate({ path: 'recipe.ingredient', select: 'name unit costPerUnit' })
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

// GET product by barcode — used by POS scanner
// Must be declared before /:id to avoid route conflict.
router.get('/barcode/:code', async (req: AuthRequest, res: Response) => {
  try {
    const normalized = String(req.params.code).trim().toUpperCase();
    if (!normalized) return res.status(400).json({ found: false, message: 'Barcode is required' });

    const product = await Product.findOne({
      hotelId:   req.hotelId,
      barcode:   normalized,
      isDeleted: false,
    })
      .populate('category', 'name color')
      .populate('kitchenStation', 'name isActive')
      .populate({ path: 'modifierGroups', match: { isDeleted: false } })
      .lean();

    if (!product) {
      return res.status(404).json({ found: false, message: 'Product not found for this barcode' });
    }
    if (!product.isAvailable) {
      return res.status(404).json({ found: false, inactive: true, message: 'Product is currently unavailable' });
    }
    res.json({ found: true, product });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET single product
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, hotelId: req.hotelId })
      .populate('category', 'name color')
      .populate('kitchenStation', 'name isActive')
      .populate({ path: 'modifierGroups', match: { isDeleted: false } })
      .populate({ path: 'recipe.ingredient', select: 'name unit costPerUnit' });
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
    const ALLOWED = ['name', 'description', 'price', 'taxPercent', 'hsnCode', 'category', 'isAvailable', 'isVeg', 'shortCode', 'barcode', 'image', 'imageSource', 'imageStatus', 'stock', 'variants', 'modifierGroups', 'kitchenStation'] as const;
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

// ── Recipe sub-resource ───────────────────────────────────────────────────────

// PUT /products/:id/recipe — replace recipe array (admin only)
// Validates each ingredient belongs to the same hotel.
router.put('/:id/recipe', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { recipe } = req.body;
    if (!Array.isArray(recipe)) {
      return res.status(400).json({ message: 'recipe must be an array' });
    }

    // Reject duplicate ingredient IDs before any DB lookup
    const seenIngredientIds = new Set<string>();
    for (const item of recipe) {
      const idStr = String(item.ingredient);
      if (seenIngredientIds.has(idStr)) {
        return res.status(400).json({ message: 'Duplicate ingredient is not allowed in a recipe.' });
      }
      seenIngredientIds.add(idStr);
    }

    const validated: { ingredient: mongoose.Types.ObjectId; quantity: number }[] = [];
    for (const item of recipe) {
      if (!mongoose.isValidObjectId(item.ingredient)) {
        return res.status(400).json({ message: `Invalid ingredient ID: ${String(item.ingredient)}` });
      }
      const qty = Number(item.quantity);
      if (!isFinite(qty) || qty < 0) {
        return res.status(400).json({ message: 'quantity must be a non-negative number' });
      }
      const ing = await Ingredient.findOne({ _id: item.ingredient, hotelId: req.hotelId });
      if (!ing) {
        return res.status(404).json({ message: `Ingredient not found: ${String(item.ingredient)}` });
      }
      validated.push({ ingredient: new mongoose.Types.ObjectId(String(item.ingredient)), quantity: qty });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { recipe: validated },
      { new: true },
    )
      .populate('category', 'name color')
      .populate({ path: 'recipe.ingredient', select: 'name unit costPerUnit' });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    logAudit(req, 'product.recipe.updated', 'product', req.params.id, { ingredientCount: validated.length });
    res.json(product);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── AI Image Generation ───────────────────────────────────────────────────────

// POST /products/:id/generate-image — generate an AI image using Gemini (admin only)
// Returns { url, prompt } — does NOT auto-save. Frontend must call PUT /:id to persist.
router.post('/:id/generate-image', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!checkImgGenRate(String(req.hotelId))) {
      return res.status(429).json({ message: 'Too many image generation requests. Try again in a minute.' });
    }

    const product = await Product.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: 'AI image generation is not configured (missing GEMINI_API_KEY)' });
    }

    const { prompt: customPrompt, style = 'menu' } = req.body as { prompt?: string; style?: string };

    const STYLES: Record<string, string> = {
      menu:   'professional restaurant menu photograph, clean studio lighting, white background, food styling, appetizing',
      rustic: 'rustic restaurant style, wooden table, warm ambient lighting, home-cooked look, natural colors',
      fine:   'fine dining presentation, elegant plating, dark moody background, luxurious, Michelin-star quality',
    };
    const styleDesc = STYLES[style] || STYLES.menu;
    const productName  = (product as any).name as string;
    const productDesc  = (product as any).description as string;

    const prompt = customPrompt?.trim() ||
      `${styleDesc}. Dish: ${productName}. ${productDesc ? productDesc + '. ' : ''}High resolution, realistic, no text overlay.`;

    // gemini-2.0-flash-preview-image-generation was retired; gemini-2.0-flash-exp
    // is the current model that supports responseModalities image output.
    const modelId = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['image', 'text'] } as Record<string, unknown>,
    });

    const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as Array<{ inlineData?: { data: string; mimeType: string } }>;
    const imagePart = parts.find(p => p.inlineData?.data);

    if (!imagePart?.inlineData) {
      return res.status(503).json({
        message: 'AI did not return an image. Ensure GEMINI_API_KEY has access to the image generation model.',
      });
    }

    // Return the image as a base64 data URL — Cloudinary upload happens only when
    // the user explicitly confirms ("Use This Image" + "Update"), preventing orphaned uploads.
    const mimeType = imagePart.inlineData.mimeType || 'image/jpeg';
    const imageData = `data:${mimeType};base64,${imagePart.inlineData.data}`;

    logAudit(req, 'product.image.aiGenerated', 'product', req.params.id, { productName });
    res.json({ imageData, prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOT_FOUND') || msg.includes('not found') || msg.includes('not supported')) {
      return res.status(503).json({
        message: `Image generation model not available. ${msg}`,
      });
    }
    sendError(res, 500, 'Image generation failed', err);
  }
});

export default router;
