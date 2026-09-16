/**
 * loyaltyExpiryWorker.ts
 *
 * Daily sweep that expires points whose expiresAt has passed.
 * Safe for repeated runs — tracks already-expired totals to avoid double-expiry.
 * Runs once per day at UTC 01:00 (scheduled from scheduler.ts).
 */

import mongoose from 'mongoose';
import CustomerProfile from '../models/CustomerProfile';
import OrganizationCustomer from '../models/OrganizationCustomer';
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

  // Aggregate branch-only earn transactions that have expired, grouped by customer.
  // orgCustomerId: null excludes org-loyalty earn transactions — those are handled
  // exclusively by runOrgLoyaltyExpiry() against OrganizationCustomer.orgLoyaltyBalance.
  // Without this filter, runLoyaltyExpiry would try to expire org-earned points against
  // CustomerProfile.loyaltyBalance, violating BR-3.
  const expiredEarns = await LoyaltyTransaction.aggregate([
    {
      $match: {
        transactionType: 'earn',
        expiresAt:       { $lte: now, $ne: null },
        orgCustomerId:   null,           // branch-only transactions only
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
      // How many points have already been expired for this customer (branch-only)?
      // orgCustomerId: null excludes org-loyalty expire records so they don't
      // inflate the alreadyExpired count and cause under-expiry of branch points.
      const alreadyRes = await LoyaltyTransaction.aggregate([
        {
          $match: {
            customerId:      record._id,
            transactionType: 'expire',
            orgCustomerId:   null,       // branch-only expire records
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

/**
 * Org-loyalty expiry sweep.
 *
 * Mirrors runLoyaltyExpiry() but operates on OrganizationCustomer.orgLoyaltyBalance
 * instead of CustomerProfile.loyaltyBalance. Must never touch CustomerProfile.
 *
 * Idempotency: tracks already-expired totals per orgCustomerId via existing
 * LoyaltyTransaction 'expire' records that have orgCustomerId set.
 * Concurrency: uses same Redis lock as single-branch expiry (date-scoped key),
 * so multi-instance environments run only once per day total.
 */
export async function runOrgLoyaltyExpiry(): Promise<void> {
  const now = new Date();

  // Distributed lock is shared with the single-branch expiry (same key, set first).
  // If the main expiry already holds the lock, org expiry skips gracefully.
  // When called independently: acquire its own date-scoped sub-lock.
  const redis = getRedisClient();
  if (redis) {
    const dateKey    = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const orgLockKey = `loyalty:expiry:org:lock:${dateKey}`;
    const acquired   = await redis.set(orgLockKey, '1', 'EX', 23 * 3600, 'NX');
    if (!acquired) {
      logger.info('[loyaltyExpiry:org] lock held by another instance — skipping sweep');
      return;
    }
  }

  logger.info('[loyaltyExpiry:org] sweep started', { ts: now.toISOString() });

  // Aggregate org earn transactions that have expired, grouped by orgCustomerId
  const expiredOrgEarns = await LoyaltyTransaction.aggregate([
    {
      $match: {
        transactionType: 'earn',
        orgCustomerId:   { $ne: null, $exists: true },
        expiresAt:       { $lte: now, $ne: null },
      },
    },
    {
      $group: {
        _id:              '$orgCustomerId',
        firstBranchId:    { $first: '$branchHotelId' },
        firstCustomerId:  { $first: '$customerId' },
        totalEarnExpired: { $sum: '$points' },
      },
    },
  ]);

  if (expiredOrgEarns.length === 0) {
    logger.info('[loyaltyExpiry:org] no expired org earn transactions found');
    return;
  }

  let expiredOrgs  = 0;
  let expiredTotal = 0;

  for (const record of expiredOrgEarns) {
    try {
      // How many points have already been expired for this org customer?
      const alreadyRes = await LoyaltyTransaction.aggregate([
        {
          $match: {
            orgCustomerId:   record._id,
            transactionType: 'expire',
          },
        },
        { $group: { _id: null, total: { $sum: { $abs: '$points' } } } },
      ]);
      const alreadyExpired = (alreadyRes[0] as any)?.total ?? 0;

      const toExpire = (record.totalEarnExpired as number) - alreadyExpired;
      if (toExpire <= 0) continue;

      // Atomically deduct from orgLoyaltyBalance — capped at 0, never negative.
      // { new: false } returns pre-update document so we compute actual expired pts.
      const beforeDoc = await OrganizationCustomer.findOneAndUpdate(
        {
          _id:               record._id,
          orgLoyaltyBalance: { $gt: 0 },
        },
        [
          {
            $set: {
              orgLoyaltyBalance: {
                $max: [0, { $subtract: ['$orgLoyaltyBalance', toExpire] }],
              },
            },
          },
        ],
        { new: false },
      );

      if (!beforeDoc) continue;

      const actualExpired = Math.min(toExpire, beforeDoc.orgLoyaltyBalance);
      const newBalance    = beforeDoc.orgLoyaltyBalance - actualExpired;

      await LoyaltyTransaction.create({
        customerId:      record.firstCustomerId,
        hotelId:         record.firstBranchId ?? beforeDoc.orgHotelId,
        orgCustomerId:   record._id,
        branchHotelId:   record.firstBranchId ?? null,
        transactionType: 'expire',
        points:          -actualExpired,
        balanceAfter:    newBalance,
        createdBy:       'system:expiry',
        remarks:         `${actualExpired} org points expired`,
      });

      expiredOrgs++;
      expiredTotal += actualExpired;
    } catch (err: any) {
      logger.warn('[loyaltyExpiry:org] failed for org customer', {
        orgCustomerId: String(record._id),
        error:         err?.message,
      });
    }
  }

  logger.info('[loyaltyExpiry:org] sweep complete', { expiredOrgs, expiredTotal });
}
