/**
 * Category Config Routes — Sprint MB-S4
 *
 * HQ admin manages category visibility per branch.
 * Default semantics: no config = category visible; explicit enabled:false = hidden.
 *
 * Route prefix: /api/category-config
 */
import { Router, Response } from 'express';
import mongoose from 'mongoose';
import CategoryConfig from '../models/CategoryConfig';
import Category from '../models/Category';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── resolveOrgContext (same pattern as catalogRoutes) ─────────────────────────

async function resolveOrgContext(hotelId: string): Promise<{
  orgHotelId: string;
  multiBranchEnabled: boolean;
  isHQ: boolean;
} | null> {
  const hotel = await Hotel.findById(hotelId).select('parentHotelId features').lean();
  if (!hotel) return null;
  const isHQ = !hotel.parentHotelId;
  const orgHotelId = isHQ ? hotelId : hotel.parentHotelId!.toString();
  let multiBranchEnabled = hotel.features?.multiBranch ?? false;
  if (!isHQ) {
    const orgHotel = await Hotel.findById(orgHotelId).select('features').lean();
    multiBranchEnabled = orgHotel?.features?.multiBranch ?? false;
  }
  return { orgHotelId, multiBranchEnabled, isHQ };
}

// ── GET /api/category-config/org ──────────────────────────────────────────────
// Org matrix: all categories with per-branch visibility status.

router.get('/org', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const orgObjId = new mongoose.Types.ObjectId(ctx.orgHotelId);

    const [categories, configs, branches] = await Promise.all([
      Category.find({ hotelId: orgObjId, isDeleted: false, isActive: true })
        .sort({ sortOrder: 1 })
        .lean(),
      CategoryConfig.find({ orgHotelId: orgObjId }).lean(),
      Hotel.find({ parentHotelId: orgObjId, status: { $in: ['active', 'trial'] } })
        .select('_id hotelName branchCode branchName status')
        .lean(),
    ]);

    // Build lookup: categoryId → branchHotelId → config
    type LeanCfg = { categoryId: mongoose.Types.ObjectId; branchHotelId: mongoose.Types.ObjectId; enabled: boolean; displayOrder?: number };
    const cfgMap = new Map<string, Map<string, LeanCfg>>();
    for (const cfg of configs) {
      const cid = cfg.categoryId.toString();
      if (!cfgMap.has(cid)) cfgMap.set(cid, new Map());
      cfgMap.get(cid)!.set(cfg.branchHotelId.toString(), cfg);
    }

    const result = categories.map(cat => ({
      ...cat,
      branchVisibility: branches.map(b => {
        const bid = b._id.toString();
        const cfg = cfgMap.get(cat._id.toString())?.get(bid);
        return {
          branchHotelId: bid,
          branchName: b.branchName || b.hotelName,
          branchCode: b.branchCode,
          enabled: cfg ? cfg.enabled : true,  // default = visible
          configured: !!cfg,
        };
      }),
    }));

    res.json({ orgHotelId: ctx.orgHotelId, categories: result, branches });
  } catch (err) {
    sendError(res, 500, 'Server error', err);
  }
});

// ── GET /api/category-config/branches/:branchId ───────────────────────────────
// Branch-specific view: all categories with their visibility status for this branch.

router.get('/branches/:branchId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId } = req.params;
    if (!mongoose.isValidObjectId(branchId)) {
      res.status(400).json({ message: 'Invalid branchId' });
      return;
    }

    const orgObjId    = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId = new mongoose.Types.ObjectId(branchId);

    const branch = await Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId })
      .select('hotelName branchCode branchName status')
      .lean();
    if (!branch) {
      res.status(403).json({ message: 'Branch does not belong to your organization' });
      return;
    }

    const [categories, configs] = await Promise.all([
      Category.find({ hotelId: orgObjId, isDeleted: false, isActive: true })
        .sort({ sortOrder: 1 })
        .lean(),
      CategoryConfig.find({ orgHotelId: orgObjId, branchHotelId: branchObjId }).lean(),
    ]);

    const cfgByCategory = new Map(configs.map(c => [c.categoryId.toString(), c]));

    const result = categories.map(cat => {
      const cfg = cfgByCategory.get(cat._id.toString());
      return {
        ...cat,
        branchConfig: {
          enabled:      cfg ? cfg.enabled : true,
          displayOrder: cfg?.displayOrder ?? null,
          configured:   !!cfg,
        },
      };
    });

    res.json({
      orgHotelId: ctx.orgHotelId,
      branchId,
      branchName: branch.branchName || branch.hotelName,
      categories: result,
    });
  } catch (err) {
    sendError(res, 500, 'Server error', err);
  }
});

// ── PUT /api/category-config/branches/:branchId/categories/:categoryId ────────
// Upsert config for one category at one branch.
// Body: { enabled: boolean, displayOrder?: number }

router.put('/branches/:branchId/categories/:categoryId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId, categoryId } = req.params;
    if (!mongoose.isValidObjectId(branchId) || !mongoose.isValidObjectId(categoryId)) {
      res.status(400).json({ message: 'Invalid branchId or categoryId' });
      return;
    }

    const orgObjId      = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId   = new mongoose.Types.ObjectId(branchId);
    const categoryObjId = new mongoose.Types.ObjectId(categoryId);

    const [branch, category] = await Promise.all([
      Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId }).select('_id').lean(),
      Category.findOne({ _id: categoryObjId, hotelId: orgObjId, isDeleted: false }).select('_id').lean(),
    ]);

    if (!branch) { res.status(403).json({ message: 'Branch does not belong to your organization' }); return; }
    if (!category) { res.status(404).json({ message: 'Category not found in organization' }); return; }

    const { enabled, displayOrder } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ message: 'enabled (boolean) is required' });
      return;
    }

    const update: Record<string, any> = { enabled };
    if (displayOrder !== undefined) update.displayOrder = Number(displayOrder) || 0;

    const config = await CategoryConfig.findOneAndUpdate(
      { orgHotelId: orgObjId, branchHotelId: branchObjId, categoryId: categoryObjId },
      { $set: { orgHotelId: orgObjId, branchHotelId: branchObjId, categoryId: categoryObjId, ...update } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    res.json({ config });
  } catch (err) {
    sendError(res, 500, 'Server error', err);
  }
});

// ── DELETE /api/category-config/branches/:branchId/categories/:categoryId ─────
// Remove config (branch falls back to default: visible).

router.delete('/branches/:branchId/categories/:categoryId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId, categoryId } = req.params;
    if (!mongoose.isValidObjectId(branchId) || !mongoose.isValidObjectId(categoryId)) {
      res.status(400).json({ message: 'Invalid branchId or categoryId' });
      return;
    }

    const orgObjId      = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId   = new mongoose.Types.ObjectId(branchId);
    const categoryObjId = new mongoose.Types.ObjectId(categoryId);

    const branch = await Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId }).select('_id').lean();
    if (!branch) { res.status(403).json({ message: 'Branch does not belong to your organization' }); return; }

    await CategoryConfig.deleteOne({ orgHotelId: orgObjId, branchHotelId: branchObjId, categoryId: categoryObjId });
    res.json({ message: 'Category config removed — category is now visible by default' });
  } catch (err) {
    sendError(res, 500, 'Server error', err);
  }
});

export default router;
