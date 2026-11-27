// Phase 5 · Batch 5 — owner Decision 3: an open shift is mandatory before the counter takes money.
//   Cash, counter UPI and counter card (and a split of them) are refused while no shift is open.
//   Online gateway payments (Razorpay, QR, webhooks) are not counter money and are not affected;
//   they are reconciled on their own. Nothing is written before the check, so a refused payment
//   leaves the order exactly as it was, and the cashier is told why (HTTP 409, SHIFT_REQUIRED).
// The shift is hotel-wide (one open shift per hotel), as before.
import mongoose from 'mongoose';
import type { Response } from 'express';
import Shift from '../models/Shift';
import Order from '../models/Order';
import { isDueAtCounter } from './counterBilling';
import { outstandingOf, PAISE } from './paymentLedger';

export const SHIFT_REQUIRED = {
  code:    'SHIFT_REQUIRED',
  message: 'Open a shift before taking payments. Cash, UPI and card payments need an open shift.',
} as const;

/** Methods the counter collects itself (not an online gateway). */
const COUNTER_METHODS = new Set(['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split']);

export function isCounterMethod(method: unknown): boolean {
  return COUNTER_METHODS.has(String(method ?? ''));
}

export async function hasOpenShift(hotelId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(hotelId)) return false;
  return !!(await Shift.exists({ hotelId: new mongoose.Types.ObjectId(hotelId), status: 'open' }));
}

/** Sends 409 SHIFT_REQUIRED and returns true when no shift is open. */
export async function refuseWithoutShift(res: Response, hotelId: string): Promise<boolean> {
  if (await hasOpenShift(hotelId)) return false;
  res.status(409).json(SHIFT_REQUIRED);
  return true;
}

/** Whether the orders matched by `filter` still owe anything at the counter (table / guest bills). */
export async function owesAtCounter(hotelId: string, filter: Record<string, unknown>): Promise<boolean> {
  const orders = await Order.find({ ...filter, hotelId, status: { $nin: ['cancelled', 'payment_pending'] } })
    .select('_id grandTotal amountSettled paymentTime status paymentMethod').lean();
  return orders.some(o => isDueAtCounter(o as any) && outstandingOf(o as any) > PAISE);
}
