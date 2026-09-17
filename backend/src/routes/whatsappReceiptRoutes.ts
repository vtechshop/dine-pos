/**
 * WhatsApp Receipt History & Management Routes
 * Mount point: /api/whatsapp-receipts
 *
 * GET  /api/whatsapp-receipts             — paginated receipt history (admin/cashier)
 * GET  /api/whatsapp-receipts/:id         — single receipt detail (admin/cashier)
 * POST /api/whatsapp-receipts/:id/retry   — manual retry (admin/cashier)
 *
 * Security invariants:
 *  - authMiddleware: all routes require valid hotel JWT
 *  - requireCashierOrAdmin: cashiers may view and retry their own hotel's receipts
 *  - hotelId filter on every DB query — hotel A cannot see hotel B's receipts
 *  - normalizedPhone is masked in responses (last 4 digits hidden from cashier view)
 *  - failureReason is already cashier-safe (no provider internals) — exposed as-is
 *  - providerMessageId exposed for admin debugging only
 *  - Retry is rate-limited: 10 retries per minute per hotel
 */

import { Router, Response }  from 'express';
import mongoose              from 'mongoose';
import { authMiddleware, requireCashierOrAdmin, AuthRequest } from '../middleware/auth';
import WhatsAppReceipt       from '../models/WhatsAppReceipt';
import { logAudit }          from '../utils/audit';
import { sendError }         from '../utils/sendError';
import { makeRateLimiter }   from '../utils/rateLimiter';

const router = Router();
const retryRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

router.use(authMiddleware);
router.use(requireCashierOrAdmin);

function _maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4) + '****';
}

function _safeReceipt(r: Record<string, unknown>, isAdmin: boolean) {
  return {
    _id:              r._id,
    orderId:          r.orderId   ?? null,
    guestId:          r.guestId   ?? null,
    customerId:       r.customerId ?? null,
    maskedPhone:      _maskPhone(String(r.normalizedPhone ?? r.phoneNumber ?? '')),
    status:           r.status,
    attemptCount:     r.attemptCount,
    maxAttempts:      r.maxAttempts,
    sentAt:           r.sentAt     ?? null,
    deliveredAt:      r.deliveredAt ?? null,
    readAt:           r.readAt      ?? null,
    failedAt:         r.failedAt    ?? null,
    failureReason:    r.failureReason ?? null,
    // providerMessageId is admin-only — cashiers don't need it
    providerMessageId: isAdmin ? (r.providerMessageId ?? null) : undefined,
    purpose:          r.purpose,
    createdAt:        r.createdAt,
    updatedAt:        r.updatedAt,
  };
}

// ── GET /api/whatsapp-receipts ────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const isAdmin    = req.role === 'admin';

    // Pagination
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1);
    const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);
    const skip  = (page - 1) * limit;

    // Filters
    const filter: Record<string, unknown> = { hotelId: hotelObjId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.orderId && mongoose.isValidObjectId(String(req.query.orderId))) {
      filter.orderId = new mongoose.Types.ObjectId(String(req.query.orderId));
    }
    if (req.query.from || req.query.to) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.from) dateFilter.$gte = new Date(String(req.query.from));
      if (req.query.to)   dateFilter.$lte = new Date(String(req.query.to));
      filter.createdAt = dateFilter;
    }

    const [receipts, total] = await Promise.all([
      WhatsAppReceipt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WhatsAppReceipt.countDocuments(filter),
    ]);

    res.json({
      receipts: receipts.map(r => _safeReceipt(r as Record<string, unknown>, isAdmin)),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    sendError(res, 500, 'Failed to load receipt history', err);
  }
});

// ── GET /api/whatsapp-receipts/:id ────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: 'Invalid receipt ID.' });
      return;
    }

    const receipt = await WhatsAppReceipt.findOne({
      _id:     new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    }).lean();

    if (!receipt) {
      res.status(404).json({ message: 'Receipt not found.' });
      return;
    }

    const isAdmin = req.role === 'admin';
    res.json(_safeReceipt(receipt as Record<string, unknown>, isAdmin));
  } catch (err) {
    sendError(res, 500, 'Failed to load receipt', err);
  }
});

// ── POST /api/whatsapp-receipts/:id/retry ─────────────────────────────────────

router.post('/:id/retry', retryRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: 'Invalid receipt ID.' });
      return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const receiptId  = new mongoose.Types.ObjectId(req.params.id);

    // Only failed or skipped receipts can be retried manually
    const receipt = await WhatsAppReceipt.findOneAndUpdate(
      {
        _id:     receiptId,
        hotelId: hotelObjId,
        status:  { $in: ['failed', 'skipped'] },
      },
      {
        $set: {
          status:        'queued',
          nextRetryAt:   null,
          failureCode:   null,
          failureReason: null,
          // Keep attemptCount so we don't endlessly retry
        },
      },
      { new: true },
    );

    if (!receipt) {
      // Find the current status for a better error message
      const current = await WhatsAppReceipt.findOne({
        _id: receiptId, hotelId: hotelObjId,
      }).select('status').lean();
      if (!current) {
        res.status(404).json({ message: 'Receipt not found.' });
        return;
      }
      res.status(409).json({
        message: `Receipt cannot be retried — current status is '${current.status}'. Only failed or skipped receipts can be retried.`,
      });
      return;
    }

    logAudit(req, 'whatsapp_receipts.manual_retry', 'whatsapp_receipt', String(receiptId), {
      orderId: receipt.orderId ? String(receipt.orderId) : undefined,
    });

    res.json({
      success: true,
      message: 'Receipt queued for retry.',
      status:  receipt.status,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to retry receipt', err);
  }
});

export default router;
