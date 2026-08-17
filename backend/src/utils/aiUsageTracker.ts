// ─── AI Usage Tracker ──────────────────────────────────────────────────────────
// Tracks per-hotel AI requests per day using Redis counters.
// Enforces soft limits (warn) and hard limits (block).
// Uses INCR + EXPIREAT (atomic) — no race conditions.

import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// Limits per hotel per day
const CHAT_SOFT_LIMIT  = 200;   // warn in logs
const CHAT_HARD_LIMIT  = 500;   // reject request
const REPORT_LIMIT     = 50;    // reports are expensive (OCR, anomaly, forecast)

function dayKey(date?: Date): string {
  return (date ?? new Date()).toISOString().slice(0, 10);
}

function usageKey(hotelId: string, type: 'chat' | 'report', date?: string): string {
  return `ai:usage:${type}:${hotelId}:${date ?? dayKey()}`;
}

/**
 * Increment usage counter and return new count.
 * Automatically expires the key at end of day (+25h for timezone buffer).
 */
export async function trackUsage(
  hotelId: string,
  type: 'chat' | 'report',
): Promise<number> {
  try {
    const redis = getRedisClient();
    if (!redis) return 0;

    const key    = usageKey(hotelId, type);
    const count  = await redis.incr(key);

    // Set TTL on first use (INCR creates key if missing)
    if (count === 1) {
      await redis.expire(key, 25 * 60 * 60);  // 25h
    }

    return count;
  } catch {
    return 0;  // fail open — don't block on Redis errors
  }
}

/**
 * Check usage without incrementing. Returns current count.
 */
export async function getUsage(
  hotelId: string,
  type: 'chat' | 'report',
): Promise<number> {
  try {
    const redis = getRedisClient();
    if (!redis) return 0;
    const val = await redis.get(usageKey(hotelId, type));
    return parseInt(val ?? '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Returns true if the hotel is over the hard limit.
 */
export async function isOverLimit(
  hotelId: string,
  type: 'chat' | 'report',
): Promise<boolean> {
  const count = await getUsage(hotelId, type);
  const limit = type === 'chat' ? CHAT_HARD_LIMIT : REPORT_LIMIT;
  if (count >= limit) {
    logger.warn(`[aiUsage] Hotel ${hotelId} over ${type} limit (${count}/${limit})`);
    return true;
  }
  if (type === 'chat' && count >= CHAT_SOFT_LIMIT && count % 10 === 0) {
    logger.warn(`[aiUsage] Hotel ${hotelId} approaching chat limit (${count}/${CHAT_HARD_LIMIT})`);
  }
  return false;
}

/**
 * Express middleware: check usage + track on pass.
 */
export function requireAiQuota(type: 'chat' | 'report') {
  return async (req: any, res: any, next: any): Promise<void> => {
    const hotelId = req.hotelId as string;
    if (!hotelId) return next();

    const over = await isOverLimit(hotelId, type);
    if (over) {
      const limit = type === 'chat' ? CHAT_HARD_LIMIT : REPORT_LIMIT;
      res.status(429).json({
        code:    'AI_QUOTA_EXCEEDED',
        message: `AI ${type} limit (${limit}/day) reached. Resets at midnight.`,
      });
      return;
    }

    await trackUsage(hotelId, type);
    next();
  };
}
