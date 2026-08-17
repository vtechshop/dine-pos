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
import { getLoyaltyConfig, adjustPoints, calculateMaxRedeemablePoints, calculateRedeemValue, calculateTier, redeemPoints } from '../utils/loyaltyUtils';
import { normalizePhone } from '../utils/phoneUtils';
import LoyaltyOtp from '../models/LoyaltyOtp';
import crypto from 'crypto';
import { getMessagingProvider } from '../services/messagingProvider';
import { logger } from '../utils/logger';

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

// ── Segment helpers ───────────────────────────────────────────────────────────

function nextSevenDayPatterns(): string[] {
  const patterns: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d   = new Date(now);
    d.setDate(d.getDate() + i);
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    patterns.push(`${m}-${day}`);
  }
  return patterns;
}

// ── CSV export helpers ────────────────────────────────────────────────────────

function escapeCsv(val: string | number | boolean | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function customerToCsvRow(doc: Record<string, any>): string {
  const avg = doc.visitCount > 0 ? Math.round((doc.lifetimeSpend ?? 0) / doc.visitCount) : 0;
  return [
    doc.name ?? '',
    doc.phone ?? '',
    doc.email ?? '',
    doc.customerId ?? '',
    doc.visitCount ?? 0,
    Math.round(doc.lifetimeSpend ?? 0),
    avg,
    doc.lastVisitAt ? new Date(doc.lastVisitAt as string | Date).toISOString().split('T')[0] : '',
    doc.birthday ?? '',
    doc.anniversary ?? '',
    doc.marketingOptIn ? 'Yes' : 'No',
    doc.loyaltyBalance ?? 0,
    doc.status ?? 'active',
    doc.createdAt ? new Date(doc.createdAt as string | Date).toISOString().split('T')[0] : '',
  ].map(escapeCsv).join(',');
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
      'maxEarnPointsPerBill',
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
// Search by phone/name or filter by segment. Supports pagination.
// RBAC: cashier | admin
// segment values: new | repeat | vip | inactive30 | inactive60 | inactive90 |
//                 birthday | anniversary | loyalty | noloyalty
// export=true: returns up to 500 records (no pagination) for CSV export
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, name, segment, page = '1', limit = '20', export: doExport } = req.query as Record<string, string>;
    const isExport = doExport === 'true';
    const pageNum  = isExport ? 1 : Math.max(1, parseInt(page, 10) || 1);
    const limitNum = isExport ? 500 : Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = isExport ? 0 : (pageNum - 1) * limitNum;

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);
    const filter: Record<string, any> = { hotelId: hotelObjId, status: { $ne: 'merged' } };
    let sort: Record<string, any> = { lastVisitAt: -1 };

    if (segment) {
      const now  = new Date();
      const mm   = String(now.getMonth() + 1).padStart(2, '0');

      switch (segment) {
        case 'new':
          filter.visitCount = 1;
          sort = { firstVisitAt: -1 };
          break;
        case 'repeat':
          filter.visitCount = { $gte: 2 };
          sort = { visitCount: -1 };
          break;
        case 'vip':
          filter.lifetimeSpend = { $gt: 0 };
          sort = { lifetimeSpend: -1 };
          break;
        case 'inactive30':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 30 * 86400000), $ne: null };
          filter.visitCount   = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'inactive60':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 60 * 86400000), $ne: null };
          filter.visitCount   = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'inactive90':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 90 * 86400000), $ne: null };
          filter.visitCount   = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'birthday':
          filter.birthday = { $regex: `^${mm}-`, $ne: null };
          break;
        case 'anniversary':
          filter.anniversary = { $regex: `^${mm}-`, $ne: null };
          break;
        case 'birthdayweek':
          filter.birthday = { $in: nextSevenDayPatterns(), $ne: null };
          break;
        case 'anniversaryweek':
          filter.anniversary = { $in: nextSevenDayPatterns(), $ne: null };
          break;
        case 'loyalty':
          filter.loyaltyBalance = { $gt: 0 };
          sort = { loyaltyBalance: -1 };
          break;
        case 'noloyalty':
          filter.loyaltyBalance = 0;
          filter.visitCount     = { $gt: 0 };
          break;
      }
    } else if (phone) {
      const escaped = String(phone).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.phone = { $regex: escaped, $options: 'i' };
    } else if (name) {
      filter.$text = { $search: String(name).trim() };
    }

    const select = isExport
      ? 'customerId name phone email birthday anniversary marketingOptIn loyaltyBalance walletBalance lifetimeSpend visitCount lastVisitAt firstVisitAt status tags notes createdAt'
      : 'customerId name phone loyaltyBalance walletBalance lifetimeSpend visitCount lastVisitAt status';

    const [customers, total] = await Promise.all([
      CustomerProfile.find(filter).sort(sort).skip(skip).limit(limitNum).select(select),
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
      'tags', 'notes', 'marketingOptIn', 'loyaltyOptOut',
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
// GET /api/loyalty/customers/lookup?phone=9876543210&amount=500
// POS cashier lookup: find a customer by phone and compute redeemable points for
// a given bill amount. Returns 404 when no profile exists (offer enrollment).
// IMPORTANT: must be registered before /customers/:customerId to avoid capture.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers/lookup', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, amount } = req.query as Record<string, string>;
    if (!phone) {
      res.status(400).json({ message: 'phone is required' });
      return;
    }

    const e164 = normalizePhone(phone);
    if (!e164) {
      res.status(400).json({ message: 'Invalid phone number format' });
      return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);
    const customer = await CustomerProfile.findOne({
      hotelId: hotelObjId,
      phone:   e164,
      status:  { $ne: 'merged' },
    }).select('customerId name phone loyaltyBalance loyaltyOptOut status lifetimeSpend').lean();

    if (!customer) {
      res.status(404).json({ message: 'No loyalty profile found for this phone number' });
      return;
    }

    if ((customer as any).status === 'blocked') {
      res.status(403).json({ message: 'Customer account is blocked' });
      return;
    }

    const config      = await getLoyaltyConfig(req.hotelId!);
    const lifetimeSpend = (customer as any).lifetimeSpend ?? 0;
    const tier         = calculateTier(lifetimeSpend, config.tierThresholds);

    if ((customer as any).loyaltyOptOut) {
      res.json({
        customer: {
          customerId:    (customer as any).customerId,
          name:          (customer as any).name,
          phone:         (customer as any).phone,
          loyaltyBalance: (customer as any).loyaltyBalance,
          loyaltyOptOut: true,
          tier,
        },
        redeemablePoints: 0,
        discountValue:    0,
        config:           null,
      });
      return;
    }

    const billAmount   = parseFloat(amount) || 0;
    const balance      = (customer as any).loyaltyBalance ?? 0;
    const redeemable   = billAmount > 0 && config.enabled
      ? calculateMaxRedeemablePoints(billAmount, balance, balance, config)
      : 0;
    const discountValue = redeemable > 0 ? calculateRedeemValue(redeemable, config) : 0;

    res.json({
      customer: {
        customerId:    (customer as any).customerId,
        name:          (customer as any).name,
        phone:         (customer as any).phone,
        loyaltyBalance: balance,
        loyaltyOptOut: false,
        tier,
      },
      redeemablePoints: redeemable,
      discountValue,
      config: config.enabled ? {
        rewardName:           config.rewardName,
        minimumRedeemPoints:  config.minimumRedeemPoints,
        maximumRedeemPercent: config.maximumRedeemPercent,
        pointValueInPaisa:    config.pointValueInPaisa,
      } : null,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to lookup customer', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/customers/export
// Streams a CSV of ALL matched customers (no record-count limit).
// IMPORTANT: registered before /customers/:customerId so 'export' is not treated
//            as a customerId parameter.
//
// Query params: segment | phone | name  (same semantics as GET /customers)
// Security: hotelId always from JWT; no client-supplied hotelId trusted.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/customers/export', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, name, segment } = req.query as Record<string, string>;
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const filter: Record<string, any> = { hotelId: hotelObjId, status: { $ne: 'merged' } };
    let sort: Record<string, any> = { lastVisitAt: -1 };

    if (segment) {
      const now = new Date();
      const mm  = String(now.getMonth() + 1).padStart(2, '0');

      switch (segment) {
        case 'new':
          filter.visitCount = 1;
          sort = { firstVisitAt: -1 };
          break;
        case 'repeat':
          filter.visitCount = { $gte: 2 };
          sort = { visitCount: -1 };
          break;
        case 'vip':
          filter.lifetimeSpend = { $gt: 0 };
          sort = { lifetimeSpend: -1 };
          break;
        case 'inactive30':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 30 * 86400000), $ne: null };
          filter.visitCount  = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'inactive60':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 60 * 86400000), $ne: null };
          filter.visitCount  = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'inactive90':
          filter.lastVisitAt = { $lt: new Date(Date.now() - 90 * 86400000), $ne: null };
          filter.visitCount  = { $gt: 0 };
          sort = { lastVisitAt: 1 };
          break;
        case 'birthday':        filter.birthday    = { $regex: `^${mm}-`, $ne: null }; break;
        case 'anniversary':     filter.anniversary = { $regex: `^${mm}-`, $ne: null }; break;
        case 'birthdayweek':    filter.birthday    = { $in: nextSevenDayPatterns(), $ne: null }; break;
        case 'anniversaryweek': filter.anniversary = { $in: nextSevenDayPatterns(), $ne: null }; break;
        case 'loyalty':         filter.loyaltyBalance = { $gt: 0 }; sort = { loyaltyBalance: -1 }; break;
        case 'noloyalty':
          filter.loyaltyBalance = 0;
          filter.visitCount     = { $gt: 0 };
          break;
      }
    } else if (phone) {
      const escaped = String(phone).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.phone = { $regex: escaped, $options: 'i' };
    } else if (name) {
      filter.$text = { $search: String(name).trim() };
    }

    // Selected IDs mode — overrides segment/phone/name filters.
    // Every ID is validated against hotelId (ownership), so Hotel B IDs
    // submitted by a Hotel A session are silently excluded.
    const idsRaw = req.query.ids;
    if (idsRaw) {
      const rawArr = Array.isArray(idsRaw)
        ? (idsRaw as string[])
        : String(idsRaw).split(',');
      const validObjIds = rawArr
        .map(id => id.trim())
        .filter(id => mongoose.isValidObjectId(id))
        .map(id => new mongoose.Types.ObjectId(id));
      if (validObjIds.length > 0) {
        // Reset segment/phone/name filters; keep hotelId + status:not-merged
        Object.keys(filter).forEach(k => {
          if (k !== 'hotelId' && k !== 'status') delete filter[k];
        });
        filter._id = { $in: validObjIds };
        sort = {};
      }
    }

    const today    = new Date().toISOString().split('T')[0];
    const filename = `dinepos-customers-${today}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // CSV header row
    res.write('Name,Phone,Email,Customer ID,Visits,Lifetime Spend,Avg Bill,Last Visit,Birthday,Anniversary,Marketing Opt-In,Loyalty Points,Status,Created\r\n');

    const exportSelect = 'customerId name phone email birthday anniversary marketingOptIn loyaltyBalance lifetimeSpend visitCount lastVisitAt createdAt status';

    const cursor = CustomerProfile
      .find(filter)
      .sort(sort)
      .select(exportSelect)
      .lean<Record<string, any>>()
      .cursor();

    for await (const doc of cursor) {
      res.write(customerToCsvRow(doc) + '\r\n');
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, 500, 'Failed to export customers', err);
    } else {
      res.end();
    }
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

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/stats
// Aggregate KPIs for the Loyalty dashboard tab.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/stats', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const [memberAgg, txAgg] = await Promise.all([
      CustomerProfile.aggregate([
        { $match: { hotelId: hotelObjId, status: { $ne: 'merged' } } },
        { $group: {
          _id: null,
          totalMembers:           { $sum: 1 },
          totalOutstandingPoints: { $sum: '$loyaltyBalance' },
          activeLast30: { $sum: {
            $cond: [
              { $and: [
                { $ne: ['$lastVisitAt', null] },
                { $gte: ['$lastVisitAt', new Date(Date.now() - 30 * 86400000)] },
              ]},
              1, 0,
            ],
          }},
        }},
      ]),
      LoyaltyTransaction.aggregate([
        { $match: { hotelId: hotelObjId } },
        { $group: { _id: '$transactionType', total: { $sum: { $abs: '$points' } } } },
      ]),
    ]);

    const m = memberAgg[0] ?? { totalMembers: 0, totalOutstandingPoints: 0, activeLast30: 0 };
    const byType: Record<string, number> = {};
    for (const t of txAgg) byType[t._id] = t.total;

    res.json({
      totalMembers:           m.totalMembers,
      totalOutstandingPoints: m.totalOutstandingPoints,
      activeLast30:           m.activeLast30,
      pointsIssued:    (byType['earn'] ?? 0) + (byType['transfer_in'] ?? 0),
      pointsRedeemed:  (byType['redeem'] ?? 0) + (byType['transfer_out'] ?? 0),
      pointsExpired:   byType['expire'] ?? 0,
      pointsAdjusted:  byType['adjust'] ?? 0,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch loyalty stats', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/activity?page=1&limit=20
// Hotel-level loyalty activity log (all transactions across all customers).
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/activity', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  as string || '1',  10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
    const skip  = (page - 1) * limit;

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find({ hotelId: hotelObjId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'customerId', select: 'name phone customerId', model: CustomerProfile })
        .lean(),
      LoyaltyTransaction.countDocuments({ hotelId: hotelObjId }),
    ]);

    res.json({ transactions, total, page, limit });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch loyalty activity', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/loyalty/customers/:customerId/status
// Block or unblock a customer. Admin only.
// Body: { status: 'active' | 'blocked' }
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/customers/:customerId/status', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body as { status?: string };
    if (!status || !['active', 'blocked'].includes(status)) {
      res.status(400).json({ message: 'status must be "active" or "blocked"' });
      return;
    }

    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) { res.status(404).json({ message: 'Customer not found' }); return; }
    if (customer.status === 'merged') {
      res.status(409).json({ message: 'Cannot change status of a merged customer record' });
      return;
    }

    customer.status = status as 'active' | 'blocked';
    await customer.save();

    res.json({ customer: { customerId: customer.customerId, name: customer.name, status: customer.status } });
  } catch (err) {
    sendError(res, 500, 'Failed to update customer status', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/loyalty/otp/send
// Generate a 6-digit OTP for loyalty point redemption and store it (hashed).
// Rate limit: max 3 pending OTPs per customer per 10-minute window.
// RBAC: cashier | admin
// Body: { phone: string }
// ────────────────────────────────────────────────────────────────────────────────
router.post('/otp/send', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };
    if (!phone) { res.status(400).json({ message: 'phone is required' }); return; }

    const e164 = normalizePhone(phone);
    if (!e164) { res.status(400).json({ message: 'Invalid phone number format' }); return; }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const customer = await CustomerProfile.findOne({
      hotelId: hotelObjId,
      phone:   e164,
      status:  'active',
      loyaltyOptOut: { $ne: true },
    }).select('_id customerId name loyaltyBalance').lean();

    if (!customer) {
      res.status(404).json({ message: 'No active loyalty profile found for this phone number' });
      return;
    }

    // Rate limit: max 3 OTP requests per customer per 10 minutes
    const windowStart = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await LoyaltyOtp.countDocuments({
      hotelId:    hotelObjId,
      customerId: (customer as any)._id,
      purpose:    'redemption',
      createdAt:  { $gte: windowStart },
    });
    if (recentCount >= 3) {
      res.status(429).json({ message: 'Too many OTP requests. Please wait 10 minutes before trying again.' });
      return;
    }

    // Generate 6-digit OTP — hashed before storage, never logged or returned
    const rawOtp    = String(crypto.randomInt(100000, 1000000));
    const hashedOtp = crypto.createHash('sha256').update(rawOtp).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-minute TTL

    await LoyaltyOtp.create({
      hotelId:    hotelObjId,
      customerId: (customer as any)._id,
      phone:      e164,
      purpose:    'redemption',
      otp:        hashedOtp,
      expiresAt,
    });

    // Deliver OTP via configured SMS/WhatsApp provider (hotel-scoped, async)
    const provider = await getMessagingProvider(req.hotelId!, 'sms');
    const sendResult = await provider.sendMessages(
      `otp-${(customer as any)._id}-${Date.now()}`,
      'sms',
      [{
        phone:      e164,
        message:    `Your loyalty redemption OTP is ${rawOtp}. Valid for 5 minutes. Do not share this code.`,
        customerId: String((customer as any)._id),
      }],
    );

    if (sendResult.status === 'no_provider') {
      // No SMS provider configured — OTP cannot be delivered.
      // In development environments, operators must configure a provider.
      logger.warn('[loyalty/otp] OTP generated but no SMS provider configured', {
        hotelId: req.hotelId,
        phone:   e164,
      });
      res.status(503).json({
        message:  'OTP generated but no SMS/WhatsApp provider is configured. Configure a provider in Settings → Integrations before enabling loyalty redemption.',
        code:     'OTP_PROVIDER_NOT_CONFIGURED',
        customer: {
          customerId:    (customer as any).customerId,
          name:          (customer as any).name,
          loyaltyBalance: (customer as any).loyaltyBalance,
        },
      });
      return;
    }

    if (sendResult.status === 'failed') {
      logger.warn('[loyalty/otp] OTP delivery failed', {
        hotelId: req.hotelId,
        phone:   e164,
        reason:  sendResult.reason,
      });
      res.status(502).json({
        message: 'OTP could not be delivered. Please try again.',
        code:    'OTP_DELIVERY_FAILED',
      });
      return;
    }

    // OTP was sent successfully — do NOT include rawOtp in the response
    res.json({
      message:   'OTP sent successfully',
      expiresIn: 300, // seconds
      customer: {
        customerId:    (customer as any).customerId,
        name:          (customer as any).name,
        loyaltyBalance: (customer as any).loyaltyBalance,
      },
    });
  } catch (err) {
    sendError(res, 500, 'Failed to generate OTP', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/loyalty/otp/verify
// Verify OTP and deduct loyalty points from the customer's balance.
// Body: { phone, otp, points, orderId? }
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/otp/verify', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, otp, points, orderId } = req.body as {
      phone?: string; otp?: string; points?: number; orderId?: string;
    };

    if (!phone) { res.status(400).json({ message: 'phone is required' }); return; }
    if (!otp)   { res.status(400).json({ message: 'otp is required' }); return; }
    if (!points || typeof points !== 'number' || points <= 0) {
      res.status(400).json({ message: 'points must be a positive number' });
      return;
    }

    const e164 = normalizePhone(phone);
    if (!e164) { res.status(400).json({ message: 'Invalid phone number format' }); return; }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const customer = await CustomerProfile.findOne({
      hotelId: hotelObjId,
      phone:   e164,
      status:  'active',
      loyaltyOptOut: { $ne: true },
    }).select('_id customerId name loyaltyBalance').lean();

    if (!customer) {
      res.status(404).json({ message: 'No active loyalty profile found' });
      return;
    }

    const hashedInput = crypto.createHash('sha256').update(String(otp)).digest('hex');

    // Find the most recent unused, unexpired OTP for this customer
    const otpDoc = await LoyaltyOtp.findOne({
      hotelId:    hotelObjId,
      customerId: (customer as any)._id,
      purpose:    'redemption',
      usedAt:     null,
      expiresAt:  { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      res.status(400).json({ message: 'No valid OTP found. Please request a new OTP.' });
      return;
    }

    // Increment attempt count atomically — max 5 attempts per OTP
    const updated = await LoyaltyOtp.findOneAndUpdate(
      { _id: otpDoc._id, attempts: { $lt: 5 }, usedAt: null },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    if (!updated) {
      res.status(429).json({ message: 'Too many incorrect attempts. Please request a new OTP.' });
      return;
    }

    if (updated.otp !== hashedInput) {
      const remaining = 5 - updated.attempts;
      res.status(400).json({ message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
      return;
    }

    // OTP is correct — mark as used
    await LoyaltyOtp.updateOne({ _id: otpDoc._id }, { $set: { usedAt: new Date() } });

    // Deduct points
    const config = await getLoyaltyConfig(req.hotelId!);
    const discountValue = await redeemPoints(
      (customer as any)._id,
      req.hotelId!,
      Math.round(points),
      config,
      {
        orderId:   orderId || undefined,
        createdBy: req.cashierName || 'cashier',
        remarks:   `OTP-verified redemption: ${Math.round(points)} ${config.rewardName}`,
      },
    );

    res.json({
      success:       true,
      discountValue,
      pointsRedeemed: Math.round(points),
      customer: {
        customerId:    (customer as any).customerId,
        name:          (customer as any).name,
        loyaltyBalance: (customer as any).loyaltyBalance - Math.round(points),
      },
    });
  } catch (err: any) {
    if (err.message?.startsWith('Insufficient')) {
      res.status(400).json({ message: err.message });
      return;
    }
    sendError(res, 500, 'Failed to verify OTP', err);
  }
});

export default router;
