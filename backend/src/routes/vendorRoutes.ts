import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Vendor from '../models/Vendor';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── GET /report — vendor summary (must precede /:id) ─────────────────────────
router.get('/report', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);
    const base = { hotelId: hotelObjId, isDeleted: false };

    const [total, active, agg, topVendors] = await Promise.all([
      Vendor.countDocuments({ hotelId: req.hotelId, isDeleted: false }),
      Vendor.countDocuments({ hotelId: req.hotelId, isDeleted: false, isActive: true }),
      Vendor.aggregate([
        { $match: base },
        { $group: {
          _id: null,
          totalOutstanding: { $sum: '$currentOutstanding' },
          totalCreditLimit: { $sum: '$creditLimit' },
        }},
      ]),
      Vendor.find({ hotelId: req.hotelId, isDeleted: false, isActive: true })
        .sort({ currentOutstanding: -1 })
        .limit(10)
        .select('businessName vendorCode currentOutstanding mobile creditLimit')
        .lean(),
    ]);

    res.json({
      totalVendors:     total,
      activeVendors:    active,
      inactiveVendors:  total - active,
      totalOutstanding: agg[0]?.totalOutstanding ?? 0,
      totalCreditLimit: agg[0]?.totalCreditLimit ?? 0,
      topVendors,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET / — list with search + pagination ─────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = { hotelId: req.hotelId, isDeleted: false };

    if (req.query.search) {
      const re = new RegExp(
        String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i',
      );
      filter.$or = [
        { businessName:  re },
        { contactPerson: re },
        { mobile:        re },
        { vendorCode:    re },
        { gstNumber:     re },
        { city:          re },
      ];
    }

    if (req.query.active === 'true')  filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;

    const ALLOWED_SORT = new Set(['businessName', 'vendorCode', 'mobile', 'city', 'currentOutstanding', 'createdAt']);
    const limit   = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip    = Math.max(parseInt(req.query.skip  as string) || 0,  0);
    const sortKey = ALLOWED_SORT.has(req.query.sort as string) ? (req.query.sort as string) : 'businessName';
    const sortDir = req.query.dir === 'desc' ? -1 : 1;

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).sort({ [sortKey]: sortDir }).skip(skip).limit(limit).lean(),
      Vendor.countDocuments(filter),
    ]);

    res.json({ vendors, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET /:id — single vendor ──────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const vendor = await Vendor.findOne({
      _id: req.params.id, hotelId: req.hotelId, isDeleted: false,
    }).lean();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    res.json(vendor);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, mobile, gstNumber } = req.body;

    if (!businessName?.trim()) return res.status(400).json({ message: 'Business name is required' });
    if (!mobile?.trim())       return res.status(400).json({ message: 'Mobile number is required' });

    const dupMobile = await Vendor.findOne({
      hotelId: req.hotelId, mobile: String(mobile).trim(), isDeleted: false,
    });
    if (dupMobile) return res.status(409).json({ message: 'A vendor with this mobile number already exists' });

    if (gstNumber?.trim()) {
      const dupGst = await Vendor.findOne({
        hotelId: req.hotelId,
        gstNumber: String(gstNumber).trim().toUpperCase(),
        isDeleted: false,
      });
      if (dupGst) return res.status(409).json({ message: 'A vendor with this GST number already exists' });
    }

    const counter = await DailyCounter.findOneAndUpdate(
      { key: `VND-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const vendorCode = `VND-${String(counter.seq).padStart(4, '0')}`;

    const vendor = await Vendor.create({
      ...req.body,
      hotelId:      req.hotelId,
      vendorCode,
      businessName: String(businessName).trim(),
      mobile:       String(mobile).trim(),
      gstNumber:    gstNumber ? String(gstNumber).trim().toUpperCase() : '',
      createdBy:    req.cashierId || req.waiterId || req.hotelId || '',
      updatedBy:    req.cashierId || req.waiterId || req.hotelId || '',
    });

    logAudit(req, 'vendor.created', 'vendor', String(vendor._id), {
      businessName: vendor.businessName,
      vendorCode:   vendor.vendorCode,
    });
    res.status(201).json(vendor);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { vendorCode: _vc, hotelId: _h, isDeleted: _d, createdBy: _c,
            currentOutstanding: _co, openingBalance: _ob, ...body } = req.body;
    const { businessName, mobile, gstNumber } = body;

    if (businessName !== undefined && !String(businessName).trim()) {
      return res.status(400).json({ message: 'Business name is required' });
    }

    if (mobile !== undefined) {
      const dup = await Vendor.findOne({
        hotelId: req.hotelId, mobile: String(mobile).trim(),
        isDeleted: false, _id: { $ne: req.params.id },
      });
      if (dup) return res.status(409).json({ message: 'A vendor with this mobile number already exists' });
    }

    if (gstNumber?.trim()) {
      const dup = await Vendor.findOne({
        hotelId:   req.hotelId,
        gstNumber: String(gstNumber).trim().toUpperCase(),
        isDeleted: false,
        _id:       { $ne: req.params.id },
      });
      if (dup) return res.status(409).json({ message: 'A vendor with this GST number already exists' });
    }

    const update: Record<string, unknown> = { ...body, updatedBy: req.hotelId ?? '' };
    if (businessName !== undefined) update.businessName = String(businessName).trim();
    if (mobile       !== undefined) update.mobile       = String(mobile).trim();
    if (gstNumber    !== undefined) update.gstNumber    = String(gstNumber).trim().toUpperCase();

    const vendor = await Vendor.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      update,
      { new: true, runValidators: true },
    );
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    logAudit(req, 'vendor.updated', 'vendor', req.params.id, {
      businessName: vendor.businessName,
    });
    res.json(vendor);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── DELETE /:id — soft delete ─────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const vendor = await Vendor.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false },
      { isDeleted: true, isActive: false, updatedBy: req.hotelId ?? '' },
      { new: true },
    );
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    logAudit(req, 'vendor.deleted', 'vendor', req.params.id, {
      businessName: vendor.businessName,
    });
    res.json({ message: 'Vendor deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── PATCH /:id/outstanding — adjust outstanding balance ───────────────────────
router.patch('/:id/outstanding', async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = req.body;
    if (typeof amount !== 'number') {
      return res.status(400).json({ message: 'amount must be a number' });
    }

    const vendor = await Vendor.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Vendor.updateOne(
        { _id: vendor._id },
        { $inc: { currentOutstanding: amount }, $set: { updatedBy: req.cashierId || req.waiterId || req.hotelId || '' } },
        { session },
      );
      await VendorLedgerEntry.create([{
        hotelId:         req.hotelId,
        vendorId:        vendor._id,
        entryType:       'adjustment',
        referenceId:     null,
        referenceNumber: '',
        debit:           amount > 0 ? amount : 0,
        credit:          amount < 0 ? Math.abs(amount) : 0,
        runningBalance:  vendor.currentOutstanding + amount,
        description:     `Manual outstanding adjustment (${amount > 0 ? '+' : ''}${amount})`,
      }], { session });
    });
    await session.endSession();

    vendor.currentOutstanding += amount;
    logAudit(req, 'vendor.outstanding.updated', 'vendor', req.params.id, {
      delta: amount, currentOutstanding: vendor.currentOutstanding,
    });
    res.json(vendor);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
