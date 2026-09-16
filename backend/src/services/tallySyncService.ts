import mongoose from 'mongoose';
import { TallyConfig } from '../models/TallyConfig';
import { TallySyncJob } from '../models/TallySyncJob';
import { logger } from '../utils/logger';

export const MAX_ATTEMPTS = 5;
// Backoff in ms after each failure: index = attemptCount after failure
// attemptCount=1 → 5min, =2 → 15min, =3 → 1hr, =4 → 4hr, =5 → 4hr (clamped)
export const BACKOFF_MS = [0, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

export function makeTallyIdempotencyKey(
  hotelId: string,
  entityType: string,
  entityId: string,
  operation: string,
): string {
  return `${hotelId}:${entityType}:${entityId}:${operation}`;
}

export function calcTallyBackoff(attemptCount: number): number {
  const idx = Math.min(attemptCount, BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

async function isTallyEnabledForHotel(hotelId: string): Promise<boolean> {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
      enabled: true,
    }).select('enabled').lean();
    return !!cfg;
  } catch {
    return false;
  }
}

async function upsertJob(fields: {
  hotelId:    string;
  entityType: string;
  entityId:   string;
  operation:  string;
}): Promise<void> {
  const { hotelId, entityType, entityId, operation } = fields;
  const key = makeTallyIdempotencyKey(hotelId, entityType, entityId, operation);

  await TallySyncJob.updateOne(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        hotelId:           new mongoose.Types.ObjectId(hotelId),
        entityType,
        entityId:          new mongoose.Types.ObjectId(entityId),
        operation,
        payloadVersion:    1,
        status:            'pending',
        idempotencyKey:    key,
        attemptCount:      0,
        lastAttemptAt:     null,
        nextAttemptAt:     null,
        syncedAt:          null,
        externalReference: '',
        voucherNumber:     '',
        errorCode:         '',
        errorReason:       '',
      },
    },
    { upsert: true },
  );
}

// Fire-and-forget: create pending TallySyncJob for a completed order.
// NEVER throws — billing must never be affected by Tally availability.
export async function createTallySyncJobForOrder(
  hotelId: string,
  orderId: mongoose.Types.ObjectId | string,
): Promise<void> {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select('enabled syncSales').lean();
    if (!cfg?.enabled || !cfg.syncSales) return;

    await upsertJob({ hotelId, entityType: 'order', entityId: String(orderId), operation: 'create' });
  } catch (e) {
    logger.warn('[tally] createTallySyncJobForOrder failed', { hotelId, orderId: String(orderId), err: String(e) });
  }
}

// Fire-and-forget: create cancellation sync job
export async function createTallySyncJobForCancellation(
  hotelId: string,
  orderId: mongoose.Types.ObjectId | string,
): Promise<void> {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select('enabled syncCancellations').lean();
    if (!cfg?.enabled || !cfg.syncCancellations) return;

    await upsertJob({ hotelId, entityType: 'cancellation', entityId: String(orderId), operation: 'cancel' });
  } catch (e) {
    logger.warn('[tally] createTallySyncJobForCancellation failed', { hotelId, orderId: String(orderId), err: String(e) });
  }
}

// Fire-and-forget: create purchase invoice sync job
export async function createTallySyncJobForPurchaseInvoice(
  hotelId: string,
  invoiceId: mongoose.Types.ObjectId | string,
): Promise<void> {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select('enabled syncPurchases').lean();
    if (!cfg?.enabled || !cfg.syncPurchases) return;

    await upsertJob({ hotelId, entityType: 'purchase_invoice', entityId: String(invoiceId), operation: 'create' });
  } catch (e) {
    logger.warn('[tally] createTallySyncJobForPurchaseInvoice failed', { hotelId, invoiceId: String(invoiceId), err: String(e) });
  }
}

// Fire-and-forget: create expense sync job
export async function createTallySyncJobForExpense(
  hotelId: string,
  expenseId: mongoose.Types.ObjectId | string,
): Promise<void> {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select('enabled syncExpenses').lean();
    if (!cfg?.enabled || !cfg.syncExpenses) return;

    await upsertJob({ hotelId, entityType: 'expense', entityId: String(expenseId), operation: 'create' });
  } catch (e) {
    logger.warn('[tally] createTallySyncJobForExpense failed', { hotelId, expenseId: String(expenseId), err: String(e) });
  }
}
