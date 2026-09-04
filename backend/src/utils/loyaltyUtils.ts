/**
 * loyaltyUtils.ts — Loyalty Engine core logic
 *
 * All monetary values are in rupees (₹).
 * Point arithmetic always uses Math integers to avoid floating-point drift.
 *
 * Earn rate: pointsPerHundredRupees (e.g. 10 → earn 10 pts per ₹100 spent)
 * Redeem rate: pointValueInPaisa (e.g. 100 → 1 pt = ₹1; 25 → 1 pt = ₹0.25)
 *
 * calculationBase 'before_gst': callers aggregate Order.subtotal per guest.
 * calculationBase 'after_gst':  callers use guest.totalAmount (grandTotal).
 */

import mongoose from 'mongoose';
import Settings, { ILoyaltySettings } from '../models/Settings';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { resolveHotelStatus } from '../middleware/auth';

export interface LoyaltyConfig extends ILoyaltySettings {
  enabled: boolean;
}

// ── Tier calculation (backend-authoritative) ──────────────────────────────────

/**
 * Compute the customer tier from lifetime spend using backend-stored thresholds.
 * Thresholds fall back to the frontend defaults when not configured.
 */
export function calculateTier(
  lifetimeSpend: number,
  thresholds?: ILoyaltySettings['tierThresholds'],
): 'Bronze' | 'Silver' | 'Gold' | 'Platinum' {
  const platinum = thresholds?.platinum ?? 30000;
  const gold     = thresholds?.gold     ?? 15000;
  const silver   = thresholds?.silver   ?? 5000;
  if (lifetimeSpend >= platinum) return 'Platinum';
  if (lifetimeSpend >= gold)     return 'Gold';
  if (lifetimeSpend >= silver)   return 'Silver';
  return 'Bronze';
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
    maxEarnPointsPerBill:   ls.maxEarnPointsPerBill    ?? 0,
    tierThresholds:         ls.tierThresholds           ?? undefined,
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
  let pts   = applyRounding(raw, config.roundingRule);
  if (config.maxEarnPointsPerBill > 0) {
    pts = Math.min(pts, config.maxEarnPointsPerBill);
  }
  return pts;
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
  sessionId?:  string;
  guestId?:    string;
  orderId?:    string;
  paymentId?:  string;
  createdBy?:  string;
  remarks?:    string;
}

/**
 * Atomically increment loyaltyBalance + append an immutable 'earn' transaction.
 * Guards:
 *   - hotelId scoped filter (multi-tenant defence)
 *   - blocked customer check (no earn on blocked profiles)
 *   - loyaltyOptOut check (customer opted out)
 */
export async function earnPoints(
  customerId: mongoose.Types.ObjectId,
  hotelId: string,
  points: number,
  config: LoyaltyConfig,
  ctx: LoyaltyContext,
): Promise<void> {
  if (points <= 0) return;

  const hotelOid = new mongoose.Types.ObjectId(hotelId);

  const updated = await CustomerProfile.findOneAndUpdate(
    {
      _id:          customerId,
      hotelId:      hotelOid,
      status:       'active',
      loyaltyOptOut: { $ne: true },
    },
    { $inc: { loyaltyBalance: points } },
    { new: true },
  );
  if (!updated) return; // deleted, wrong hotel, blocked, or opted-out — ignore silently

  const expiresAt = config.expiryDays > 0
    ? new Date(Date.now() + config.expiryDays * 24 * 60 * 60 * 1000)
    : null;

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         hotelOid,
    sessionId:       ctx.sessionId  ? new mongoose.Types.ObjectId(ctx.sessionId)  : null,
    guestId:         ctx.guestId    ? new mongoose.Types.ObjectId(ctx.guestId)    : null,
    orderId:         ctx.orderId    ? new mongoose.Types.ObjectId(ctx.orderId)    : null,
    paymentId:       ctx.paymentId  ? new mongoose.Types.ObjectId(ctx.paymentId)  : null,
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
 * Guards:
 *   - hotelId scoped filter (multi-tenant defence)
 *   - blocked customer check
 *   - loyaltyOptOut check
 *   - conditional $gte so the decrement is atomic (no check-then-act race)
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

  const hotelOid = new mongoose.Types.ObjectId(hotelId);

  const updated = await CustomerProfile.findOneAndUpdate(
    {
      _id:           customerId,
      hotelId:       hotelOid,
      status:        'active',
      loyaltyOptOut: { $ne: true },
      loyaltyBalance: { $gte: points },
    },
    { $inc: { loyaltyBalance: -points } },
    { new: true },
  );
  if (!updated) throw new Error('Insufficient loyalty points or customer ineligible');

  const discountAmount = calculateRedeemValue(points, config);

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         hotelOid,
    sessionId:       ctx.sessionId  ? new mongoose.Types.ObjectId(ctx.sessionId)  : null,
    guestId:         ctx.guestId    ? new mongoose.Types.ObjectId(ctx.guestId)    : null,
    orderId:         ctx.orderId    ? new mongoose.Types.ObjectId(ctx.orderId)    : null,
    paymentId:       ctx.paymentId  ? new mongoose.Types.ObjectId(ctx.paymentId)  : null,
    transactionType: 'redeem',
    points:          -points,
    balanceAfter:    updated.loyaltyBalance,
    createdBy:       ctx.createdBy ?? 'system',
    remarks:         `Redeemed ${points} ${config.rewardName} for ₹${discountAmount} discount`,
  });

  return discountAmount;
}

/**
 * Reverse earned points (used on refund/cancellation).
 * Idempotent — callers must check Payment.loyaltyReversedAt before calling.
 * Does not go below zero (caps deduction to current balance).
 */
export async function reverseEarnedPoints(
  customerId: mongoose.Types.ObjectId,
  hotelId: string,
  points: number,
  config: LoyaltyConfig,
  ctx: LoyaltyContext,
): Promise<void> {
  if (points <= 0) return;

  const hotelOid = new mongoose.Types.ObjectId(hotelId);

  // Deduct up to the current balance (can't go negative)
  const updated = await CustomerProfile.findOneAndUpdate(
    { _id: customerId, hotelId: hotelOid },
    [
      {
        $set: {
          loyaltyBalance: {
            $max: [0, { $subtract: ['$loyaltyBalance', points] }],
          },
        },
      },
    ],
    { new: false }, // pre-update doc to compute actual deducted amount
  );
  if (!updated) return;

  const actualReversed = Math.min(points, updated.loyaltyBalance);
  if (actualReversed <= 0) return;

  const newBalance = updated.loyaltyBalance - actualReversed;

  await LoyaltyTransaction.create({
    customerId,
    hotelId:         hotelOid,
    sessionId:       ctx.sessionId  ? new mongoose.Types.ObjectId(ctx.sessionId)  : null,
    guestId:         ctx.guestId    ? new mongoose.Types.ObjectId(ctx.guestId)    : null,
    orderId:         ctx.orderId    ? new mongoose.Types.ObjectId(ctx.orderId)    : null,
    paymentId:       ctx.paymentId  ? new mongoose.Types.ObjectId(ctx.paymentId)  : null,
    transactionType: 'reverse',
    points:          -actualReversed,
    balanceAfter:    newBalance,
    createdBy:       ctx.createdBy ?? 'system',
    remarks:         ctx.remarks   ?? `Reversed ${actualReversed} ${config.rewardName} on refund`,
  });
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
): Promise<{ newBalance: number; updatedDoc: any }> {
  if (delta === 0) throw new Error('Adjustment cannot be zero');

  let updated: any;
  if (delta < 0) {
    updated = await CustomerProfile.findOneAndUpdate(
      { _id: customerId, hotelId: new mongoose.Types.ObjectId(hotelId), loyaltyBalance: { $gte: -delta } },
      { $inc: { loyaltyBalance: delta } },
      { new: true },
    );
    if (!updated) throw new Error('Insufficient loyalty points for debit adjustment');
  } else {
    // C-10: credit path must also be hotel-scoped to prevent cross-hotel balance manipulation
    updated = await CustomerProfile.findOneAndUpdate(
      { _id: customerId, hotelId: new mongoose.Types.ObjectId(hotelId) },
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

  return { newBalance: updated.loyaltyBalance, updatedDoc: updated };
}
