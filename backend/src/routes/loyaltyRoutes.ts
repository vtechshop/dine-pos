/**
 * Loyalty Routes  (Phase 6)
 * Mount point: /api/loyalty
 *
 * All routes require:
 *   - authMiddleware (hotel JWT)
 *   - requireFeature('loyaltyProgram')
 *
 * Endpoints:
 *   GET  /config                              — hotel's loyalty settings
 *   PUT  /config                              — update loyalty settings (admin)
 *   GET  /customers?phone=&name=&page=&limit= — search customers
 *   POST /customers                           — create a new customer
 *   GET  /customers/:customerId               — profile + balance (CUST-XXX or ObjectId)
 *   GET  /customers/:customerId/transactions  — paginated point history
 *   POST /customers/:customerId/adjust        — manual ±point adjustment (admin)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware,
  requireAdmin,
  requireCashierOrAdmin,
  AuthRequest,
} from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import Settings from '../models/Settings';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import DailyCounter from '../models/DailyCounter';
import { getLoyaltyConfig, adjustPoints } from '../utils/loyaltyUtils';

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

async function generateCustomerId(hotelId: string): Promise<string> {
  const key     = `LOYALTYCUST-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  const shortId = hotelId.slice(-6).toUpperCase();
  return `CUST-${shortId}-${String(counter!.seq).padStart(4, '0')}`;
}

const router = Router();

router.use(authMiddleware);
router.use(requireFeature('loyaltyProgram'));

// ── Helper: resolve CustomerProfile from CUST-XXX string or ObjectId ──────────
async function resolveCustomer(id: string, hotelId: string) {
  const hotelObjId = new mongoose.Types.ObjectId(hotelId);

  if (mongoose.isValidObjectId(id)) {
    return CustomerProfile.findOne({ _id: id, hotelId: hotelObjId });
  }
  // Human-readable CUST-XXX format
  return CustomerProfile.findOne({ customerId: id, hotelId: hotelObjId });
}

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/config
// Returns the hotel's current loyalty settings.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/config', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await getLoyaltyConfig(req.hotelId!);
    res.json({ config });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch loyalty config', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PUT /api/loyalty/config
// Update the hotel's loyalty settings (persisted to Settings document).
// RBAC: admin only
// ────────────────────────────────────────────────────────────────────────────────
router.put('/config', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const allowed = [
      'rewardName',
      'pointsPerHundredRupees',
      'minimumRedeemPoints',
      'maximumRedeemPercent',
      'pointValueInPaisa',
      'expiryDays',
      'roundingRule',
      'calculationBase',
    ] as const;

    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[`loyaltySettings.${key}`] = req.body[key];
      }
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ message: 'No valid fields provided' });
      return;
    }

    const settings = await Settings.findOneAndUpdate(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId) },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );

    res.json({ config: settings?.loyaltySettings });
  } catch (err: any) {
    if (err.name === 'ValidationError' || err.name === 'CastError') {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: err.message });
      return;
    }
    sendError(res, 500, 'Failed to update loyalty config', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/customers
// Search customers by phone or name. Supports pagination.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, name, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = {
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      status:  { $ne: 'merged' },
    };

    if (phone) {
      const escaped = String(phone).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.phone = { $regex: escaped, $options: 'i' };
    } else if (name) {
      filter.$text = { $search: String(name).trim() };
    }

    const [customers, total] = await Promise.all([
      CustomerProfile.find(filter)
        .sort({ lastVisitAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('customerId name phone loyaltyBalance walletBalance lifetimeSpend visitCount lastVisitAt status'),
      CustomerProfile.countDocuments(filter),
    ]);

    res.json({ customers, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to search customers', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/loyalty/customers
// Create a new loyalty customer for this hotel.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/customers', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name, phone, email, birthday, anniversary,
      gstCustomer, companyName, gstin, tags, notes, marketingOptIn,
    } = req.body as Record<string, any>;

    const cleanName = String(name ?? '').trim().slice(0, 100);
    if (!cleanName) {
      res.status(400).json({ message: 'name is required' });
      return;
    }

    const cleanPhone = String(phone ?? '').trim();
    if (!cleanPhone) {
      res.status(400).json({ message: 'phone is required' });
      return;
    }
    const normalizedPhone = normalizePhone(cleanPhone);
    if (!normalizedPhone) {
      res.status(400).json({ message: 'Invalid phone number — must be a 10-digit Indian mobile number' });
      return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const duplicate = await CustomerProfile.findOne({ hotelId: hotelObjId, phone: normalizedPhone });
    if (duplicate) {
      res.status(409).json({ message: 'A customer with this phone number already exists', customerId: duplicate.customerId });
      return;
    }

    const customerId = await generateCustomerId(req.hotelId!);

    const customer = await CustomerProfile.create({
      hotelId:      hotelObjId,
      customerId,
      name:         cleanName,
      phone:        normalizedPhone,
      email:        email ? String(email).trim().slice(0, 200) : undefined,
      birthday:     birthday ? String(birthday).trim().slice(0, 5) : undefined,
      anniversary:  anniversary ? String(anniversary).trim().slice(0, 5) : undefined,
      gstCustomer:  Boolean(gstCustomer),
      companyName:  companyName ? String(companyName).trim().slice(0, 150) : '',
      gstin:        gstin ? String(gstin).trim().toUpperCase().slice(0, 15) : '',
      tags:         Array.isArray(tags) ? tags.map(String).slice(0, 10) : [],
      notes:        notes ? String(notes).trim().slice(0, 1000) : '',
      marketingOptIn: Boolean(marketingOptIn),
      loyaltyBalance: 0,
      walletBalance:  0,
      lifetimeSpend:  0,
      visitCount:     0,
      status:         'active',
    });

    res.status(201).json({ customer });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ message: 'A customer with this phone number already exists' });
      return;
    }
    sendError(res, 500, 'Failed to create customer', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/loyalty/customers/:customerId
// Update mutable fields of a customer profile.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/customers/:customerId', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) { res.status(404).json({ message: 'Customer not found' }); return; }
    if (customer.status === 'merged') { res.status(409).json({ message: 'Cannot edit a merged customer record' }); return; }

    const allowed = [
      'name', 'email', 'birthday', 'anniversary',
      'gstCustomer', 'companyName', 'gstin',
      'tags', 'notes', 'marketingOptIn',
      'deliveryAddresses',
    ] as const;

    let changed = false;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        (customer as any)[key] = req.body[key];
        changed = true;
      }
    }

    if (!changed) { res.status(400).json({ message: 'No valid fields to update' }); return; }

    await customer.save();
    res.json({ customer });
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      res.status(400).json({ message: err.message });
      return;
    }
    sendError(res, 500, 'Failed to update customer', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/customers/:customerId
// Customer profile + current loyalty balance.
// :customerId accepts the CUST-XXX-NNNN string OR a MongoDB ObjectId.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers/:customerId', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json({ customer });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch customer', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/customers/:customerId/transactions
// Paginated point history for a customer (newest first).
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers/:customerId/transactions', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }

    const page     = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
    const skip     = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find({
        customerId: customer._id,
        hotelId:    new mongoose.Types.ObjectId(req.hotelId),
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments({
        customerId: customer._id,
        hotelId:    new mongoose.Types.ObjectId(req.hotelId),
      }),
    ]);

    res.json({
      customer: {
        customerId:    customer.customerId,
        name:          customer.name,
        phone:         customer.phone,
        loyaltyBalance: customer.loyaltyBalance,
      },
      transactions,
      total,
      page,
      limit,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch loyalty transactions', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/loyalty/customers/:customerId/adjust
// Manual ±point adjustment. Positive = credit, negative = debit.
// Requires a remarks string (audit trail).
// RBAC: admin only
// ────────────────────────────────────────────────────────────────────────────────
router.post('/customers/:customerId/adjust', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { points, remarks } = req.body as { points?: number; remarks?: string };

    if (typeof points !== 'number' || points === 0) {
      res.status(400).json({ message: 'points must be a non-zero number' });
      return;
    }
    if (!remarks || !String(remarks).trim()) {
      res.status(400).json({ message: 'remarks is required for audit trail' });
      return;
    }

    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    if (customer.status !== 'active') {
      res.status(409).json({ message: `Cannot adjust points for ${customer.status} customer` });
      return;
    }

    const config    = await getLoyaltyConfig(req.hotelId!);
    const createdBy = `admin:${req.hotelId}`;

    const { newBalance, updatedDoc } = await adjustPoints(
      customer._id as mongoose.Types.ObjectId,
      req.hotelId!,
      Math.round(points),
      String(remarks).trim(),
      createdBy,
      config,
    );

    res.json({ newBalance, customerId: customer.customerId, customer: updatedDoc });
  } catch (err: any) {
    if (err.message?.startsWith('Insufficient')) {
      res.status(400).json({ message: err.message });
      return;
    }
    sendError(res, 500, 'Failed to adjust loyalty points', err);
  }
});

export default router;
