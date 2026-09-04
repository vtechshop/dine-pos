import { getRedisClient } from '../config/redis';

// Today's brief: 6h (changes if regenerated during the day)
const TODAY_TTL   = 6  * 60 * 60;
// Past briefs: stable — 7 days
const HISTORY_TTL = 7  * 24 * 60 * 60;

const briefKey  = (hotelId: string, date: string) => `dinepos:ai:brief:${hotelId}:${date}`;
const latestKey = (hotelId: string)               => `dinepos:ai:brief:latest:${hotelId}`;

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

export async function getCachedBrief(hotelId: string, date: string): Promise<unknown | null> {
  return cacheGet(briefKey(hotelId, date));
}

export async function setCachedBrief(
  hotelId:  string,
  date:     string,
  payload:  unknown,
  isToday:  boolean,
): Promise<void> {
  const ttl = isToday ? TODAY_TTL : HISTORY_TTL;
  await cacheSet(briefKey(hotelId, date), payload, ttl);
  // Only update the latest pointer for today's brief; past-date regeneration
  // must not overwrite the latest key with stale data.
  if (isToday) await cacheSet(latestKey(hotelId), payload, ttl);
}

export async function getCachedLatestBrief(hotelId: string): Promise<unknown | null> {
  return cacheGet(latestKey(hotelId));
}

export async function invalidateBriefCache(hotelId: string, date: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(briefKey(hotelId, date));
    await redis.del(latestKey(hotelId));
  } catch { /* best-effort */ }
}
