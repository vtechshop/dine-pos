/**
 * loyaltyUtils.ts — Loyalty Engine core logic (Phase 6)
 *
 * All monetary values are in rupees (₹).
 * Point arithmetic always uses Math integers to avoid floating-point drift.
 *
 * Earn rate: pointsPerHundredRupees (e.g. 10 → earn 10 pts per ₹100 spent)
 * Redeem rate: pointValueInPaisa (e.g. 100 → 1 pt = ₹1; 25 → 1 pt = ₹0.25)
 *
 * Note on calculationBase: guests only carry totalAmount (post-GST grandTotal).
 * The pre-GST subtotal is not denormalized on Guest. Phase 6 uses grandTotal
 * for both 'before_gst' and 'after_gst' modes. A later phase can resolve this
 * by summing order.subtotal per guest when exactness is required.
 */

import mongoose from 'mongoose';
import Settings, { ILoyaltySettings } from '../models/Settings';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { resolveHotelStatus } from '../middleware/auth';

export interface LoyaltyConfig extends ILoyaltySettings {
  enabled: boolean;
}

// ── Config loader (Redis-cached hotel status + Settings lookup) ────────────────
export async function getLoyaltyConfig(hotelId: string): Promise<LoyaltyConfig> {
  const [entry, settings] = await Promise.all([
    resolveHotelStatus(hotelId),
    Settings.findOne({ hotelId: new mongoose.Types.ObjectId(hotelId) })
      .select('loyaltySettings')
      .lean(),
  ]);

  const enabled = Boolean((entry.features as any)?.loyaltyProgram);
  const ls      = (settings as any)?.loyaltySettings ?? {};

  return {
    enabled,
    rewardName:             ls.rewardName             ?? 'Points',
    pointsPerHundredRupees: ls.pointsPerHundredRupees ?? 10,
    minimumRedeemPoints:    ls.minimumRedeemPoints     ?? 100,
    maximumRedeemPercent:   ls.maximumRedeemPercent    ?? 10,
    pointValueInPaisa:      ls.pointValueInPaisa       ?? 100,
    expiryDays:             ls.expiryDays              ?? 0,
    roundingRule:           ls.roundingRule            ?? 'floor',
    calculationBase:        ls.calculationBase         ?? 'before_gst',
  };
}

// ── Point arithmetic ──────────────────────────────────────────────────────────

function applyRounding(value: number, rule: 'floor' | 'round' | 'ceil'): number {
  if (rule === 'round') return Math.round(value);
  if (rule === 'ceil')  return Math.ceil(value);
  return Math.floor(value);
}

/** Points earned for a given bill amount. Returns 0 when loyalty is disabled. */
export function calculateEarnedPoints(totalAmount: number, config: LoyaltyConfig): number {
  if (!config.enabled || config.pointsPerHundredRupees <= 0) return 0;
  const raw = (totalAmount / 100) * config.pointsPerHundredRupees;
  return applyRounding(raw, config.roundingRule);
}

/**
 * How many points from `requested` can actually be redeemed.
 * Enforces the maximumRedeemPercent cap and the customer's current balance.
 */
export function calculateMaxRedeemablePoints(
  totalAmount: number,
  customerBalance: number,
  requested: number,
  config: LoyaltyConfig,
): number {
  // rupeeValuePerPoint = pointValueInPaisa / 100
  // maxRupeeDiscount   = totalAmount * maximumRedeemPercent / 100
  // maxPoints          = floor(maxRupeeDiscount / rupeeValuePerPoint)
  //                    = floor((totalAmount * maximumRedeemPercent) / pointValueInPaisa)
  const maxByPercent = Math.floor(
    (totalAmount * config.maximumRedeemPercent) / config.pointValueInPaisa,
  );
  return Math.min(requested, customerBalance, maxByPercent);
}

/** Rupee value for a given number of points (rounded to 2 decimals). */
export function calculateRedeemValue(points: number, config: LoyaltyConfig): number {
  return +((points * config.pointValueInPaisa) / 100).toFixed(2);
}

// ── Ledger operations ─────────────────────────────────────────────────────────

export interface LoyaltyContext {
  sessionId?: string;
  guestId?:   string;
  createdBy?: string;
  remarks?:   string;
}

/**
 * Atomically increment loyaltyBalance + append an immutable 'earn' transaction.
 * Uses findByIdAndUpdate (new:true) so balanceAfter is accurate even under concurrency.
 */
export async function earnPoints(
  customerId: mongoose.Types.ObjectId,
  hotelId: string,
  points: number,
  config: LoyaltyConfig,
  ctx: LoyaltyContext,
): Promise<void> {
  if (points <= 0) return;

  const updated = await CustomerProfile.findByIdAndUpdate(
    customerId,
    { $inc: { loyaltyBalance: points } },
    { new: true },
  );
  if (!updated) return; // customer deleted between billing and earn — ignore

  const expiresAt = config.expiryDays > 0
    ? new Date(Date.now() + config.expiryDays * 24 * 60 * 60 * 1000)
    : null;

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         new mongoose.Types.ObjectId(hotelId),
    sessionId:       ctx.sessionId ? new mongoose.Types.ObjectId(ctx.sessionId) : null,
    guestId:         ctx.guestId   ? new mongoose.Types.ObjectId(ctx.guestId)   : null,
    transactionType: 'earn',
    points,
    balanceAfter:    updated.loyaltyBalance,
    expiresAt,
    createdBy:       ctx.createdBy ?? 'system',
    remarks:         ctx.remarks   ?? `Earned ${points} ${config.rewardName}`,
  });
}

/**
 * Atomically decrement loyaltyBalance + append an immutable 'redeem' transaction.
 * Uses a conditional filter { loyaltyBalance: { $gte: points } } so the decrement
 * is atomic — no separate check-then-act race possible.
 * Returns the rupee discount value for the caller to apply to the bill.
 */
export async function redeemPoints(
  customerId: mongoose.Types.ObjectId,
  hotelId: string,
  points: number,
  config: LoyaltyConfig,
  ctx: LoyaltyContext,
): Promise<number> {
  if (points <= 0) return 0;

  const updated = await CustomerProfile.findOneAndUpdate(
    { _id: customerId, loyaltyBalance: { $gte: points } },
    { $inc: { loyaltyBalance: -points } },
    { new: true },
  );
  if (!updated) throw new Error('Insufficient loyalty points');

  const discountAmount = calculateRedeemValue(points, config);

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         new mongoose.Types.ObjectId(hotelId),
    sessionId:       ctx.sessionId ? new mongoose.Types.ObjectId(ctx.sessionId) : null,
    guestId:         ctx.guestId   ? new mongoose.Types.ObjectId(ctx.guestId)   : null,
    transactionType: 'redeem',
    points:          -points,
    balanceAfter:    updated.loyaltyBalance,
    createdBy:       ctx.createdBy ?? 'system',
    remarks:         `Redeemed ${points} ${config.rewardName} for ₹${discountAmount} discount`,
  });

  return discountAmount;
}

/**
 * Manual point adjustment by admin (positive = credit, negative = debit).
 * Validates sufficient balance before a debit.
 */
export async function adjustPoints(
  customerId: mongoose.Types.ObjectId,
  hotelId: string,
  delta: number,
  remarks: string,
  createdBy: string,
  config: LoyaltyConfig,
): Promise<{ newBalance: number }> {
  if (delta === 0) throw new Error('Adjustment cannot be zero');

  let updated: any;
  if (delta < 0) {
    updated = await CustomerProfile.findOneAndUpdate(
      { _id: customerId, loyaltyBalance: { $gte: -delta } },
      { $inc: { loyaltyBalance: delta } },
      { new: true },
    );
    if (!updated) throw new Error('Insufficient loyalty points for debit adjustment');
  } else {
    updated = await CustomerProfile.findByIdAndUpdate(
      customerId,
      { $inc: { loyaltyBalance: delta } },
      { new: true },
    );
    if (!updated) throw new Error('Customer not found');
  }

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         new mongoose.Types.ObjectId(hotelId),
    transactionType: 'adjust',
    points:          delta,
    balanceAfter:    updated.loyaltyBalance,
    createdBy,
    remarks:         remarks.slice(0, 500),
  });

  return { newBalance: updated.loyaltyBalance };
}
