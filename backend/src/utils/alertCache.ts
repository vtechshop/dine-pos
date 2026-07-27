import { getRedisClient } from '../config/redis';

// ─── TTLs ─────────────────────────────────────────────────────────────────────
const TODAY_TTL = 30 * 60;         // 30 min — today's data changes each hourly run
const PAST_TTL  = 24 * 60 * 60;    // 24 h  — past-day alerts are stable
const REC_TTL_TODAY = 2 * 60 * 60; // 2 h   — recommendations refresh less often
const REC_TTL_PAST  = 48 * 60 * 60;// 48 h  — past-day recommendations

const alertKey = (hotelId: string, date: string) =>
  `dinepos:ai:alerts:${hotelId}:${date}`;

const recKey = (hotelId: string, date: string) =>
  `dinepos:ai:recs:${hotelId}:${date}`;

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function getCachedAlerts(hotelId: string, date: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(alertKey(hotelId, date));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedAlerts(
  hotelId:  string,
  date:     string,
  payload:  unknown,
  isToday:  boolean,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const ttl = isToday ? TODAY_TTL : PAST_TTL;
  try {
    await redis.setex(alertKey(hotelId, date), ttl, JSON.stringify(payload));
  } catch { /* best-effort */ }
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getCachedRecommendations(hotelId: string, date: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(recKey(hotelId, date));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedRecommendations(
  hotelId:  string,
  date:     string,
  payload:  unknown,
  isToday:  boolean,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const ttl = isToday ? REC_TTL_TODAY : REC_TTL_PAST;
  try {
    await redis.setex(recKey(hotelId, date), ttl, JSON.stringify(payload));
  } catch { /* best-effort */ }
}
