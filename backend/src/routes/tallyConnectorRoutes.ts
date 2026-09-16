// Authenticated connector polling API for the Tally Bridge.
// The local bridge (running on the customer's machine) polls these endpoints.
// Authentication: hotel-scoped bearer token (NOT admin JWT).
// NEVER expose this token externally or log it.

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { TallyConfig } from '../models/TallyConfig';
import { TallySyncJob, ITallySyncJob } from '../models/TallySyncJob';
import Order from '../models/Order';
import PurchaseInvoice from '../models/PurchaseInvoice';
import Expense from '../models/Expense';
import Settings from '../models/Settings';
import { decrypt } from '../utils/encryption';
import {
  buildTallyVoucherXml,
  buildTallyCancellationXml,
  resolvePaymentLedger,
  validateBalance,
} from '../services/tallyXmlBuilder';
import { calcTallyBackoff, MAX_ATTEMPTS } from '../services/tallySyncService';
import { logger } from '../utils/logger';

const router = Router();

async function resolveHotelFromToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 10) return null;

  // Brute-force scan is acceptable: connector poll is infrequent (seconds apart)
  // and the number of TallyConfig docs per deployment is small (< 1000).
  const configs = await TallyConfig.find({
    connectorToken: { $nin: ['', null] },
    enabled:        true,
  }).select('hotelId connectorToken').lean();

  for (const cfg of configs) {
    try {
      const plain = decrypt(cfg.connectorToken);
      if (plain === token) return String(cfg.hotelId);
    } catch { /* corrupted entry — skip */ }
  }
  return null;
}

// POST /api/integrations/tally/connector/poll — claim next pending job
router.post('/poll', async (req: Request, res: Response): Promise<void> => {
  try {
    const hotelId = await resolveHotelFromToken(req.headers.authorization);
    if (!hotelId) {
      res.status(401).json({ message: 'Invalid connector token' });
      return;
    }

    const now = new Date();

    // Atomic claim: pending → syncing
    const job = await TallySyncJob.findOneAndUpdate(
      {
        hotelId:  new mongoose.Types.ObjectId(hotelId),
        status:   'pending',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { $set: { status: 'syncing', lastAttemptAt: now } },
      { new: true, sort: { createdAt: 1 } },
    );

    if (!job) {
      res.json({ job: null });
      return;
    }

    // Record connector heartbeat
    await TallyConfig.updateOne(
      { hotelId: new mongoose.Types.ObjectId(hotelId) },
      { $set: { connectorLastSeenAt: now } },
    ).catch(() => {});

    const payload = await buildJobPayload(hotelId, job);

    // Empty payload = entity missing or entries failed balance check — not retryable
    if (!payload) {
      await TallySyncJob.updateOne(
        { _id: job._id },
        { $set: { status: 'skipped', errorCode: 'BUILD_FAILED', errorReason: 'Payload build failed: entity missing or balance check failed' } },
      ).catch(() => {});
      res.json({ job: null });
      return;
    }

    res.json({
      job: {
        _id:            job._id,
        entityType:     job.entityType,
        operation:      job.operation,
        idempotencyKey: job.idempotencyKey,
        payload,
      },
    });
  } catch (e) {
    logger.error('[tally-connector] poll error', { err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/integrations/tally/connector/ack — report result
router.post('/ack', async (req: Request, res: Response): Promise<void> => {
  try {
    const hotelId = await resolveHotelFromToken(req.headers.authorization);
    if (!hotelId) {
      res.status(401).json({ message: 'Invalid connector token' });
      return;
    }

    const { jobId, success, externalReference, voucherNumber, errorCode, errorReason } = req.body;
    if (!jobId) {
      res.status(400).json({ message: 'jobId required' });
      return;
    }

    const job = await TallySyncJob.findOne({
      _id:     jobId,
      hotelId: new mongoose.Types.ObjectId(hotelId),
      status:  'syncing',
    });
    if (!job) {
      res.status(404).json({ message: 'Job not found or not in syncing state' });
      return;
    }

    if (success) {
      job.status            = 'synced';
      job.syncedAt          = new Date();
      job.externalReference = String(externalReference || '');
      job.voucherNumber     = String(voucherNumber || '');
      job.errorCode         = '';
      job.errorReason       = '';
    } else {
      job.attemptCount += 1;
      job.errorCode     = String(errorCode || 'UNKNOWN').slice(0, 100);
      job.errorReason   = String(errorReason || '').slice(0, 500);

      if (job.attemptCount >= MAX_ATTEMPTS) {
        job.status        = 'failed';
        job.nextAttemptAt = null;
      } else {
        const backoffMs   = calcTallyBackoff(job.attemptCount);
        job.status        = 'pending';
        job.nextAttemptAt = new Date(Date.now() + backoffMs);
      }
    }

    await job.save();
    res.json({ message: 'Acknowledged', status: job.status });
  } catch (e) {
    logger.error('[tally-connector] ack error', { err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/integrations/tally/connector/heartbeat — connector alive ping
router.post('/heartbeat', async (req: Request, res: Response): Promise<void> => {
  try {
    const hotelId = await resolveHotelFromToken(req.headers.authorization);
    if (!hotelId) {
      res.status(401).json({ message: 'Invalid connector token' });
      return;
    }
    await TallyConfig.updateOne(
      { hotelId: new mongoose.Types.ObjectId(hotelId) },
      { $set: { connectorLastSeenAt: new Date() } },
    ).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

async function buildJobPayload(hotelId: string, job: ITallySyncJob): Promise<string> {
  const cfg = await TallyConfig.findOne({
    hotelId: new mongoose.Types.ObjectId(hotelId),
  }).lean();
  if (!cfg) return '';

  const settings = await Settings.findOne({
    hotelId: new mongoose.Types.ObjectId(hotelId),
  }).select('hotelName gstNumber').lean() as any;

  const ledger = cfg.ledgerMap;

  if (job.entityType === 'order' && job.operation === 'create') {
    return buildOrderXml(job, cfg, settings, ledger);
  }
  if (job.entityType === 'cancellation' && job.operation === 'cancel') {
    return buildCancellationXml(job, cfg, settings, ledger);
  }
  if (job.entityType === 'purchase_invoice') {
    return buildPurchaseXml(job, cfg, settings, ledger);
  }
  if (job.entityType === 'expense') {
    return buildExpenseXml(job, cfg, settings, ledger);
  }
  return '';
}

async function buildOrderXml(job: ITallySyncJob, cfg: any, settings: any, ledger: any): Promise<string> {
  const order = await Order.findById(job.entityId).lean() as any;
  if (!order) return '';

  const grandTotal = +(order.grandTotal ?? 0).toFixed(2);
  const taxTotal   = +(order.taxTotal   ?? 0).toFixed(2);
  const cgst       = +(taxTotal / 2).toFixed(2);
  const sgst       = +(taxTotal / 2).toFixed(2);
  const subtotal   = +(grandTotal - taxTotal).toFixed(2);
  const discount   = +(order.discountAmount ?? 0).toFixed(2);
  const walletAmt  = +(order.walletAmount ?? 0).toFixed(2);
  const payLedger  = resolvePaymentLedger(order.paymentMethod ?? 'cash', ledger.cashLedger, ledger.bankLedger);

  // Double-entry: Debit party (payment), Credit sales + taxes
  const netReceivable = +(grandTotal - discount - walletAmt).toFixed(2);

  const entries: { ledgerName: string; amount: number }[] = [
    { ledgerName: payLedger,          amount:  netReceivable },  // Dr
    { ledgerName: ledger.salesLedger, amount: -subtotal      },  // Cr
    { ledgerName: ledger.cgstLedger,  amount: -cgst          },  // Cr
    { ledgerName: ledger.sgstLedger,  amount: -sgst          },  // Cr
  ];

  if (discount > 0) {
    entries.push({ ledgerName: ledger.discountLedger, amount: +discount });  // Dr expense
  }
  if (walletAmt > 0) {
    entries.push({ ledgerName: ledger.walletLedger, amount: +walletAmt });   // Dr liability
  }

  if (!validateBalance(entries)) {
    logger.error('[tally] buildOrderXml: entries do not balance', {
      jobId: String(job._id),
      sum:   entries.reduce((a, e) => a + e.amount, 0),
    });
    return '';
  }

  return buildTallyVoucherXml({
    guid:          job.idempotencyKey,
    companyName:   cfg.companyName,
    voucherType:   'Sales',
    voucherDate:   new Date(order.createdAt),
    voucherNumber: order.orderNumber ?? String(order._id),
    narration:     `Order ${order.orderNumber} | ${settings?.hotelName ?? ''}`,
    ledgerEntries: entries,
  });
}

async function buildCancellationXml(job: ITallySyncJob, cfg: any, settings: any, ledger: any): Promise<string> {
  const order = await Order.findById(job.entityId).lean() as any;
  if (!order) return '';

  const grandTotal = +(order.grandTotal ?? 0).toFixed(2);
  const taxTotal   = +(order.taxTotal   ?? 0).toFixed(2);
  const cgst       = +(taxTotal / 2).toFixed(2);
  const sgst       = +(taxTotal / 2).toFixed(2);
  const subtotal   = +(grandTotal - taxTotal).toFixed(2);
  const payLedger  = resolvePaymentLedger(order.paymentMethod ?? 'cash', ledger.cashLedger, ledger.bankLedger);

  const cancellationEntries = [
    { ledgerName: ledger.salesLedger, amount:  subtotal  },  // Dr
    { ledgerName: ledger.cgstLedger,  amount:  cgst      },  // Dr
    { ledgerName: ledger.sgstLedger,  amount:  sgst      },  // Dr
    { ledgerName: payLedger,          amount: -grandTotal },  // Cr
  ];

  if (!validateBalance(cancellationEntries)) {
    logger.error('[tally] buildCancellationXml: entries do not balance', {
      jobId: String(job._id),
      sum:   cancellationEntries.reduce((a, e) => a + e.amount, 0),
    });
    return '';
  }

  return buildTallyCancellationXml({
    guid:          job.idempotencyKey,
    companyName:   cfg.companyName,
    voucherDate:   new Date(),
    voucherNumber: `CANCEL-${order.orderNumber ?? String(order._id)}`,
    narration:     `Cancellation of Order ${order.orderNumber}`,
    ledgerEntries: cancellationEntries,
  });
}

async function buildPurchaseXml(job: ITallySyncJob, cfg: any, settings: any, ledger: any): Promise<string> {
  const inv = await PurchaseInvoice.findById(job.entityId).lean() as any;
  if (!inv) return '';

  const grandTotal = +(inv.grandTotal ?? 0).toFixed(2);
  const taxTotal   = +(inv.taxTotal   ?? 0).toFixed(2);
  const cgst       = +(taxTotal / 2).toFixed(2);
  const sgst       = +(taxTotal / 2).toFixed(2);
  const base       = +(grandTotal - taxTotal).toFixed(2);

  const purchaseEntries = [
    { ledgerName: ledger.purchaseLedger, amount:  base       },  // Dr
    { ledgerName: ledger.cgstLedger,     amount:  cgst       },  // Dr (input tax)
    { ledgerName: ledger.sgstLedger,     amount:  sgst       },  // Dr (input tax)
    { ledgerName: 'Creditors',           amount: -grandTotal  },  // Cr
  ];

  if (!validateBalance(purchaseEntries)) {
    logger.error('[tally] buildPurchaseXml: entries do not balance', {
      jobId: String(job._id),
      sum:   purchaseEntries.reduce((a, e) => a + e.amount, 0),
    });
    return '';
  }

  return buildTallyVoucherXml({
    guid:          job.idempotencyKey,
    companyName:   cfg.companyName,
    voucherType:   'Purchase',
    voucherDate:   new Date(inv.invoiceDate),
    voucherNumber: inv.invoiceNumber ?? String(inv._id),
    narration:     `Purchase Invoice ${inv.invoiceNumber} | ${inv.vendorSnapshot?.businessName ?? ''}`,
    ledgerEntries: purchaseEntries,
  });
}

async function buildExpenseXml(job: ITallySyncJob, cfg: any, settings: any, ledger: any): Promise<string> {
  const exp = await Expense.findById(job.entityId).lean() as any;
  if (!exp) return '';

  const amt = +(exp.amount ?? 0).toFixed(2);

  const expenseEntries = [
    { ledgerName: ledger.expenseLedger, amount:  amt  },  // Dr
    { ledgerName: ledger.cashLedger,    amount: -amt  },  // Cr (all expenses assumed cash — no paymentMode field)
  ];

  if (!validateBalance(expenseEntries)) {
    logger.error('[tally] buildExpenseXml: entries do not balance', {
      jobId: String(job._id),
      sum:   expenseEntries.reduce((a, e) => a + e.amount, 0),
    });
    return '';
  }

  return buildTallyVoucherXml({
    guid:          job.idempotencyKey,
    companyName:   cfg.companyName,
    voucherType:   'Payment',
    voucherDate:   new Date(exp.date ?? exp.createdAt),
    voucherNumber: String(exp._id).slice(-8).toUpperCase(),
    narration:     `Expense: ${exp.description} (${exp.category})`,
    ledgerEntries: expenseEntries,
  });
}

export default router;
