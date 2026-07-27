import { getRedisClient } from '../config/redis';

// Forecasts are recomputed once per day; cache for 6h so they stay fresh
// if a new snapshot lands mid-day without invalidating.
const FORECAST_TTL  = 6 * 60 * 60;    // 6h
const INVENTORY_TTL = 4 * 60 * 60;    // 4h — stock changes more frequently

const forecastKey  = (hotelId: string) => `dinepos:ai:forecast:${hotelId}`;
const inventoryKey = (hotelId: string) => `dinepos:ai:inventory:${hotelId}`;

// ── Sales / demand forecast ────────────────────────────────────────────────────

export async function getCachedForecast(hotelId: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(forecastKey(hotelId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedForecast(hotelId: string, payload: unknown): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(forecastKey(hotelId), FORECAST_TTL, JSON.stringify(payload));
  } catch { /* best-effort */ }
}

export async function invalidateForecastCache(hotelId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(forecastKey(hotelId));
  } catch { /* best-effort */ }
}

// ── Inventory prediction ──────────────────────────────────────────────────────

export async function getCachedInventory(hotelId: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(inventoryKey(hotelId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedInventory(hotelId: string, payload: unknown): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(inventoryKey(hotelId), INVENTORY_TTL, JSON.stringify(payload));
  } catch { /* best-effort */ }
}
