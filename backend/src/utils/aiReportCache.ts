import crypto from 'crypto';
import { getRedisClient } from '../config/redis';

const PAST_TTL    = 7 * 24 * 60 * 60; // 7 days — past day data is stable
const CURRENT_TTL = 60 * 60;           // 1 hour — today's data changes each hourly run

function narrativeKey(hotelId: string, date: string, inputHash: string): string {
  return `dinepos:ai:narrative:${hotelId}:${date}:${inputHash}`;
}

/**
 * Short hash of the KPI object passed to Gemini.
 * A change in input (e.g. snapshot recomputed after a late order) causes a cache miss,
 * so Gemini is called again with the updated figures.
 */
export function hashNarrativeInput(input: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 16);
}

export async function getCachedNarrative(
  hotelId:   string,
  date:      string,
  inputHash: string,
): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    return await redis.get(narrativeKey(hotelId, date, inputHash));
  } catch {
    return null;
  }
}

export async function setCachedNarrative(
  hotelId:   string,
  date:      string,
  inputHash: string,
  narrative: string,
  isToday:   boolean,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const ttl = isToday ? CURRENT_TTL : PAST_TTL;
  try {
    await redis.setex(narrativeKey(hotelId, date, inputHash), ttl, narrative);
  } catch { /* best-effort */ }
}
