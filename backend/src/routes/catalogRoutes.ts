/**
 * Organization Catalog Routes — Sprint MB-S3
 *
 * HQ admin manages shared product catalog visibility and pricing per branch.
 * All orgHotelId is derived from req.hotelId (JWT), never from client input.
 *
 * Route prefix: /api/catalog
 */
import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import Hotel from '../models/Hotel';
import BranchProductConfig from '../models/BranchProductConfig';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── Authorization helper ───────────────────────────────────────────────────────

/**
 * Resolve orgHotelId from the JWT-authenticated hotelId.
 * Returns { orgHotelId, multiBranchEnabled } or null if the hotel is not found.
 * A branch admin calling this gets the HQ hotel ID (not their own branch ID).
 */
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

// ── GET /api/catalog/products ──────────────────────────────────────────────────
// HQ admin view: all org products with branch config matrix.
// Returns each product annotated with configs for all branches.

router.get('/products', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const orgObjId = new mongoose.Types.ObjectId(ctx.orgHotelId);

    // Fetch org products + all configs in parallel
    const [products, configs, branches] = await Promise.all([
      Product.find({ hotelId: orgObjId, isDeleted: false })
        .populate('category', 'name color')
        .populate('kitchenStation', 'name')
        .lean(),
      BranchProductConfig.find({ orgHotelId: orgObjId }).lean(),
      Hotel.find({ parentHotelId: orgObjId, status: { $in: ['active', 'trial'] } })
        .select('_id hotelName branchCode branchName status')
        .lean(),
    ]);

    // Build config lookup: productId → branchHotelId → config
    type LeanConfig = { productId: mongoose.Types.ObjectId; branchHotelId: mongoose.Types.ObjectId; enabled: boolean; sellingPrice?: number; displayOrder?: number };
    const configMap = new Map<string, Map<string, LeanConfig>>();
    for (const cfg of configs) {
      const pid = cfg.productId.toString();
      if (!configMap.has(pid)) configMap.set(pid, new Map());
      configMap.get(pid)!.set(cfg.branchHotelId.toString(), cfg);
    }

    const result = products.map(p => ({
      ...p,
      branchConfigs: branches.map(b => {
        const bid = b._id.toString();
        const cfg = configMap.get(p._id.toString())?.get(bid);
        return {
          branchHotelId: bid,
          branchName:    b.branchName || b.hotelName,
          branchCode:    b.branchCode,
          enabled:       cfg?.enabled ?? false,
          sellingPrice:  cfg?.sellingPrice ?? null,
          displayOrder:  cfg?.displayOrder ?? null,
          configured:    !!cfg,
        };
      }),
    }));

    res.json({ orgHotelId: ctx.orgHotelId, products: result, branches });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET /api/catalog/branches/:branchId/products ───────────────────────────────
// HQ admin view: get all product configs for a specific branch.

router.get('/branches/:branchId/products', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      res.status(400).json({ message: 'Invalid branchId' });
      return;
    }

    const orgObjId    = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId = new mongoose.Types.ObjectId(branchId);

    // Validate branch belongs to this org
    const branch = await Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId })
      .select('hotelName branchCode branchName status')
      .lean();
    if (!branch) {
      res.status(403).json({ message: 'Branch does not belong to your organization' });
      return;
    }

    const [products, configs] = await Promise.all([
      Product.find({ hotelId: orgObjId, isDeleted: false })
        .populate('category', 'name color')
        .lean(),
      BranchProductConfig.find({ orgHotelId: orgObjId, branchHotelId: branchObjId }).lean(),
    ]);

    const configByProduct = new Map(configs.map(c => [c.productId.toString(), c]));

    const result = products.map(p => {
      const cfg = configByProduct.get(p._id.toString());
      return {
        ...p,
        branchConfig: {
          enabled:       cfg?.enabled ?? false,
          sellingPrice:  cfg?.sellingPrice ?? null,
          displayOrder:  cfg?.displayOrder ?? null,
          configured:    !!cfg,
        },
      };
    });

    res.json({
      orgHotelId: ctx.orgHotelId,
      branchId,
      branchName: branch.branchName || branch.hotelName,
      products:   result,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── PUT /api/catalog/branches/:branchId/products/:productId ───────────────────
// HQ admin: upsert branch config for one product.
// Body: { enabled, sellingPrice?, displayOrder? }

router.put('/branches/:branchId/products/:productId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId, productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(branchId) || !mongoose.Types.ObjectId.isValid(productId)) {
      res.status(400).json({ message: 'Invalid branchId or productId' });
      return;
    }

    const orgObjId    = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId = new mongoose.Types.ObjectId(branchId);
    const productObjId = new mongoose.Types.ObjectId(productId);

    // Validate branch belongs to this org
    const [branch, product] = await Promise.all([
      Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId }).select('_id').lean(),
      Product.findOne({ _id: productObjId, hotelId: orgObjId, isDeleted: false }).select('_id price').lean(),
    ]);

    if (!branch) {
      res.status(403).json({ message: 'Branch does not belong to your organization' });
      return;
    }
    if (!product) {
      res.status(404).json({ message: 'Product not found in organization catalog' });
      return;
    }

    const { enabled, sellingPrice, displayOrder } = req.body;

    const update: Record<string, any> = {};
    if (typeof enabled === 'boolean') update.enabled = enabled;
    if (sellingPrice !== undefined && sellingPrice !== null) {
      const price = Number(sellingPrice);
      if (isNaN(price) || price < 0) {
        res.status(400).json({ message: 'sellingPrice must be a non-negative number' });
        return;
      }
      update.sellingPrice = price;
    } else if (sellingPrice === null) {
      // null = remove the override, fall back to product.price
      update.sellingPrice = undefined;
    }
    if (displayOrder !== undefined) update.displayOrder = Number(displayOrder) || 0;

    const config = await BranchProductConfig.findOneAndUpdate(
      { orgHotelId: orgObjId, branchHotelId: branchObjId, productId: productObjId },
      { $set: { orgHotelId: orgObjId, branchHotelId: branchObjId, productId: productObjId, ...update } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    res.json({ config });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /api/catalog/branches/:branchId/products/bulk ────────────────────────
// HQ admin: batch-configure multiple products for a branch.
// Body: { configs: [{ productId, enabled, sellingPrice? }] }
// Limited to 200 products per call.

router.post('/branches/:branchId/products/bulk', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      res.status(400).json({ message: 'Invalid branchId' });
      return;
    }

    const orgObjId    = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId = new mongoose.Types.ObjectId(branchId);

    const branch = await Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId }).select('_id').lean();
    if (!branch) {
      res.status(403).json({ message: 'Branch does not belong to your organization' });
      return;
    }

    const items: Array<{ productId: string; enabled: boolean; sellingPrice?: number }> =
      req.body.configs ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'configs array is required and must be non-empty' });
      return;
    }
    if (items.length > 200) {
      res.status(400).json({ message: 'Maximum 200 products per bulk operation' });
      return;
    }

    const productIds = items
      .map(i => i.productId)
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    // Validate all productIds belong to this org
    const validProducts = await Product.find({
      _id: { $in: productIds },
      hotelId: orgObjId,
      isDeleted: false,
    }).select('_id').lean();

    const validSet = new Set(validProducts.map(p => p._id.toString()));

    const ops = items
      .filter(i => mongoose.Types.ObjectId.isValid(i.productId) && validSet.has(i.productId))
      .map(i => ({
        updateOne: {
          filter: {
            orgHotelId:    orgObjId,
            branchHotelId: branchObjId,
            productId:     new mongoose.Types.ObjectId(i.productId),
          },
          update: {
            $set: {
              orgHotelId:    orgObjId,
              branchHotelId: branchObjId,
              productId:     new mongoose.Types.ObjectId(i.productId),
              enabled:       i.enabled ?? true,
              ...(i.sellingPrice != null ? { sellingPrice: Number(i.sellingPrice) } : {}),
            },
          },
          upsert: true,
        },
      }));

    if (ops.length === 0) {
      res.status(400).json({ message: 'No valid products found in organization catalog' });
      return;
    }

    const result = await BranchProductConfig.bulkWrite(ops, { ordered: false });
    res.json({
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      totalProcessed: ops.length,
      skippedCount: items.length - ops.length,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── DELETE /api/catalog/branches/:branchId/products/:productId ────────────────
// HQ admin: remove branch config for a product (branch falls back to "not configured").

router.delete('/branches/:branchId/products/:productId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrgContext(req.hotelId!);
    if (!ctx) { res.status(404).json({ message: 'Hotel not found' }); return; }
    if (!ctx.multiBranchEnabled) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { branchId, productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(branchId) || !mongoose.Types.ObjectId.isValid(productId)) {
      res.status(400).json({ message: 'Invalid branchId or productId' });
      return;
    }

    const orgObjId    = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const branchObjId = new mongoose.Types.ObjectId(branchId);
    const productObjId = new mongoose.Types.ObjectId(productId);

    const branch = await Hotel.findOne({ _id: branchObjId, parentHotelId: orgObjId }).select('_id').lean();
    if (!branch) {
      res.status(403).json({ message: 'Branch does not belong to your organization' });
      return;
    }

    await BranchProductConfig.deleteOne({
      orgHotelId: orgObjId,
      branchHotelId: branchObjId,
      productId: productObjId,
    });

    res.json({ message: 'Branch product configuration removed' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
