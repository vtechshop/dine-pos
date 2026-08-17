/**
 * loyaltyExpiryWorker.ts
 *
 * Daily sweep that expires points whose expiresAt has passed.
 * Safe for repeated runs — tracks already-expired totals to avoid double-expiry.
 * Runs once per day at UTC 01:00 (scheduled from scheduler.ts).
 */

import mongoose from 'mongoose';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

export async function runLoyaltyExpiry(): Promise<void> {
  const now = new Date();

  // Distributed lock: prevents duplicate sweeps when multiple backend instances
  // trigger simultaneously. Key is date-scoped so it auto-rotates each calendar day.
  // Falls through gracefully when Redis is unavailable (single-instance envs are
  // protected by the scheduler's own expiryLastDate in-process guard).
  const redis = getRedisClient();
  if (redis) {
    const dateKey  = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const lockKey  = `loyalty:expiry:lock:${dateKey}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 23 * 3600, 'NX');
    if (!acquired) {
      logger.info('[loyaltyExpiry] lock held by another instance — skipping sweep');
      return;
    }
  }

  logger.info('[loyaltyExpiry] sweep started', { ts: now.toISOString() });

  // Aggregate all earn transactions that have expired, grouped by customer
  const expiredEarns = await LoyaltyTransaction.aggregate([
    {
      $match: {
        transactionType: 'earn',
        expiresAt:       { $lte: now, $ne: null },
      },
    },
    {
      $group: {
        _id:              '$customerId',
        hotelId:          { $first: '$hotelId' },
        totalEarnExpired: { $sum: '$points' },
      },
    },
  ]);

  if (expiredEarns.length === 0) {
    logger.info('[loyaltyExpiry] no expired earn transactions found');
    return;
  }

  let expiredCustomers = 0;
  let expiredTotal     = 0;

  for (const record of expiredEarns) {
    try {
      // How many points have already been expired for this customer?
      const alreadyRes = await LoyaltyTransaction.aggregate([
        {
          $match: {
            customerId:      record._id,
            transactionType: 'expire',
          },
        },
        { $group: { _id: null, total: { $sum: { $abs: '$points' } } } },
      ]);
      const alreadyExpired = (alreadyRes[0] as any)?.total ?? 0;

      const toExpire = (record.totalEarnExpired as number) - alreadyExpired;
      if (toExpire <= 0) continue;

      // Atomically deduct — cap to current balance so it never goes negative.
      // Use { new: false } to get the pre-update document so we can compute
      // the exact points removed (Math.min(toExpire, preBalance)).
      const beforeDoc = await CustomerProfile.findOneAndUpdate(
        {
          _id:            record._id,
          hotelId:        record.hotelId as mongoose.Types.ObjectId,
          loyaltyBalance: { $gt: 0 },
        },
        [
          {
            $set: {
              loyaltyBalance: {
                $max: [0, { $subtract: ['$loyaltyBalance', toExpire] }],
              },
            },
          },
        ],
        { new: false },
      );

      if (!beforeDoc) continue;

      const actualExpired = Math.min(toExpire, beforeDoc.loyaltyBalance);
      const newBalance    = beforeDoc.loyaltyBalance - actualExpired;

      await LoyaltyTransaction.create({
        customerId:      record._id,
        hotelId:         record.hotelId as mongoose.Types.ObjectId,
        transactionType: 'expire',
        points:          -actualExpired,
        balanceAfter:    newBalance,
        createdBy:       'system:expiry',
        remarks:         `${actualExpired} points expired`,
      });

      expiredCustomers++;
      expiredTotal += actualExpired;
    } catch (err: any) {
      logger.warn('[loyaltyExpiry] failed for customer', {
        customerId: String(record._id),
        error:      err?.message,
      });
    }
  }

  logger.info('[loyaltyExpiry] sweep complete', { expiredCustomers, expiredTotal });
}
