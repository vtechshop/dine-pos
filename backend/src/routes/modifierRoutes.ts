import { Router, Response } from 'express';
import mongoose from 'mongoose';
import ModifierGroup from '../models/ModifierGroup';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();

router.use(authMiddleware);

// ── GET /api/modifiers — list all modifier groups for hotel ───────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string) || 100, 200);
    const skip   = parseInt(req.query.skip as string) || 0;
    const filter: any = { hotelId: req.hotelId, isDeleted: false };

    if (req.query.active === 'true')  filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;
    if (req.query.search) {
      const escaped = (req.query.search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }

    const [groups, total] = await Promise.all([
      ModifierGroup.find(filter).sort({ displayOrder: 1, name: 1 }).skip(skip).limit(limit),
      ModifierGroup.countDocuments(filter),
    ]);
    res.json({ groups, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET /api/modifiers/:id — single group ─────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const group = await ModifierGroup.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!group) return res.status(404).json({ message: 'Modifier group not found' });
    res.json(group);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /api/modifiers — create ──────────────────────────────────────────────
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, isActive, displayOrder, isRequired, selectionType, minSelections, maxSelections, options } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'name is required' });
    if (selectionType && !['single', 'multi'].includes(selectionType)) {
      return res.status(400).json({ message: 'selectionType must be single or multi' });
    }

    const group = await ModifierGroup.create({
      hotelId:       req.hotelId,
      name:          String(name).trim(),
      description:   description ? String(description).trim() : '',
      isActive:      isActive !== false,
      displayOrder:  Number(displayOrder) || 0,
      isRequired:    isRequired === true,
      selectionType: selectionType || 'single',
      minSelections: Number(minSelections) || 0,
      maxSelections: Number(maxSelections) || 1,
      options:       Array.isArray(options) ? options.map((o: any) => ({
        name:         String(o.name || '').trim(),
        price:        Number(o.price) || 0,
        sku:          String(o.sku || '').trim(),
        barcode:      String(o.barcode || '').trim(),
        isActive:     o.isActive !== false,
        displayOrder: Number(o.displayOrder) || 0,
      })) : [],
    });

    logAudit(req, 'modifierGroup.created', 'modifierGroup', String(group._id), { name: group.name });
    res.status(201).json(group);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── PUT /api/modifiers/:id — update ──────────────────────────────────────────
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const ALLOWED = ['name', 'description', 'isActive', 'displayOrder', 'isRequired', 'selectionType', 'minSelections', 'maxSelections'] as const;
    const update: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.name) update.name = String(update.name).trim();
    if (update.selectionType && !['single', 'multi'].includes(update.selectionType as string)) {
      return res.status(400).json({ message: 'selectionType must be single or multi' });
    }

    const group = await ModifierGroup.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      update,
      { new: true, runValidators: true }
    );
    if (!group) return res.status(404).json({ message: 'Modifier group not found' });
    logAudit(req, 'modifierGroup.updated', 'modifierGroup', req.params.id, { name: group.name });
    res.json(group);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── DELETE /api/modifiers/:id — soft delete ───────────────────────────────────
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const group = await ModifierGroup.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!group) return res.status(404).json({ message: 'Modifier group not found' });
    // Cascade: remove the deleted group's ref from all products in this hotel
    await Product.updateMany(
      { hotelId: req.hotelId },
      { $pull: { modifierGroups: group._id } },
    );
    logAudit(req, 'modifierGroup.deleted', 'modifierGroup', req.params.id, { name: group.name });
    res.json({ message: 'Modifier group deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /api/modifiers/:id/options — add option ─────────────────────────────
router.post('/:id/options', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const { name, price, sku, barcode, isActive, displayOrder } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'option name is required' });
    if (typeof price !== 'number' || price < 0) return res.status(400).json({ message: 'price must be a number ≥ 0' });

    const group = await ModifierGroup.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { $push: { options: { name: String(name).trim(), price, sku: sku || '', barcode: barcode || '', isActive: isActive !== false, displayOrder: Number(displayOrder) || 0 } } },
      { new: true, runValidators: true }
    );
    if (!group) return res.status(404).json({ message: 'Modifier group not found' });
    logAudit(req, 'modifierGroup.option.added', 'modifierGroup', req.params.id, { optionName: name });
    res.status(201).json(group);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── PUT /api/modifiers/:id/options/:optId — update option ────────────────────
router.put('/:id/options/:optId', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.optId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const setFields: Record<string, unknown> = {};
    if (req.body.name         !== undefined) setFields['options.$.name']         = String(req.body.name).trim();
    if (req.body.price        !== undefined) setFields['options.$.price']        = Number(req.body.price);
    if (req.body.sku          !== undefined) setFields['options.$.sku']          = String(req.body.sku).trim();
    if (req.body.barcode      !== undefined) setFields['options.$.barcode']      = String(req.body.barcode).trim();
    if (req.body.isActive     !== undefined) setFields['options.$.isActive']     = Boolean(req.body.isActive);
    if (req.body.displayOrder !== undefined) setFields['options.$.displayOrder'] = Number(req.body.displayOrder);

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ message: 'Provide at least one field to update' });
    }
    const group = await ModifierGroup.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, 'options._id': new mongoose.Types.ObjectId(req.params.optId) },
      { $set: setFields },
      { new: true, runValidators: true }
    );
    if (!group) return res.status(404).json({ message: 'Modifier group or option not found' });
    logAudit(req, 'modifierGroup.option.updated', 'modifierGroup', req.params.id, { optionId: req.params.optId });
    res.json(group);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── DELETE /api/modifiers/:id/options/:optId — remove option ─────────────────
router.delete('/:id/options/:optId', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.optId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const group = await ModifierGroup.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { $pull: { options: { _id: new mongoose.Types.ObjectId(req.params.optId) } } },
      { new: true }
    );
    if (!group) return res.status(404).json({ message: 'Modifier group not found' });
    logAudit(req, 'modifierGroup.option.deleted', 'modifierGroup', req.params.id, { optionId: req.params.optId });
    res.json(group);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
