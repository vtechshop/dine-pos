import crypto from 'crypto';
import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// Unique per process — prevents us from releasing another instance's lock.
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');

const lockKey = (name: string): string => `dinepos:scheduler:lock:${name}`;

/**
 * Acquire a distributed scheduler lock via Redis SET NX EX (atomic).
 * Returns true if the lock was acquired.
 * Falls back to true (non-blocking) when Redis is unavailable so a
 * single instance can always run.
 */
export async function acquireSchedulerLock(name: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true; // Redis unavailable → single-instance fallback

  const result = await redis.set(lockKey(name), INSTANCE_ID, 'EX', ttlSeconds, 'NX');
  if (result === 'OK') return true;

  logger.info(`[schedulerLock] ${name} held by another instance — skipping`);
  return false;
}

/**
 * Release a lock we own.  Lua check-and-delete ensures we never release
 * a lock that another instance re-acquired after our TTL expired.
 */
export async function releaseSchedulerLock(name: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const lua =
    'if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end';
  try {
    await (redis as any).eval(lua, 1, lockKey(name), INSTANCE_ID);
  } catch (err) {
    logger.warn('[schedulerLock] release failed', { name, err: String(err) });
  }
}
