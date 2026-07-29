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
import { logger } from '../utils/logger';

export async function runLoyaltyExpiry(): Promise<void> {
  const now = new Date();
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

      // Atomically deduct — cap to current balance so it never goes negative
      const updated = await CustomerProfile.findOneAndUpdate(
        {
          _id:            record._id,
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
        { new: true },
      );

      if (!updated) continue;

      const actualExpired = Math.min(toExpire, updated.loyaltyBalance + toExpire);

      await LoyaltyTransaction.create({
        customerId:      record._id,
        hotelId:         record.hotelId as mongoose.Types.ObjectId,
        transactionType: 'expire',
        points:          -actualExpired,
        balanceAfter:    updated.loyaltyBalance,
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
