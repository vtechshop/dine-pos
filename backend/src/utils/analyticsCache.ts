import { getRedisClient } from '../config/redis';

const ANOMALY_TTL = 2  * 60 * 60;
const STAFF_TTL   = 6  * 60 * 60;
const KITCHEN_TTL = 6  * 60 * 60;

const anomalyKey = (hotelId: string) => `dinepos:ai:anomaly:${hotelId}`;
const staffKey   = (hotelId: string) => `dinepos:ai:staff:${hotelId}`;
const kitchenKey = (hotelId: string) => `dinepos:ai:kitchen:${hotelId}`;

async function cacheGet(key: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, payload: unknown, ttl: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(key, ttl, JSON.stringify(payload));
  } catch { /* best-effort */ }
}

export const getCachedAnomaly  = (hotelId: string): Promise<unknown | null> => cacheGet(anomalyKey(hotelId));
export const setCachedAnomaly  = (hotelId: string, p: unknown): Promise<void> => cacheSet(anomalyKey(hotelId), p, ANOMALY_TTL);
export const getCachedStaff    = (hotelId: string): Promise<unknown | null> => cacheGet(staffKey(hotelId));
export const setCachedStaff    = (hotelId: string, p: unknown): Promise<void> => cacheSet(staffKey(hotelId), p, STAFF_TTL);
export const getCachedKitchen  = (hotelId: string): Promise<unknown | null> => cacheGet(kitchenKey(hotelId));
export const setCachedKitchen  = (hotelId: string, p: unknown): Promise<void> => cacheSet(kitchenKey(hotelId), p, KITCHEN_TTL);
