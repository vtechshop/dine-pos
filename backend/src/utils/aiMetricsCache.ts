import { getRedisClient } from '../config/redis';
import { IItemMetric } from '../models/HourlyMetrics';

const TTL_SECONDS = 48 * 60 * 60; // 48 hours

// ─── Key builders ─────────────────────────────────────────────────────────────

function hotKey(hotelId: string): string {
  return `dinepos:ai:hot:${hotelId}:today`;
}

function leaderboardKey(hotelId: string, date: string): string {
  return `dinepos:ai:leaderboard:${hotelId}:${date}`;
}

// ─── Hot metrics (today's running revenue + order count) ──────────────────────

export interface HotMetrics {
  revenue:   number;
  orders:    number;
  updatedAt: string; // ISO string
}

export async function setHotMetrics(
  hotelId:  string,
  revenue:  number,
  orders:   number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = hotKey(hotelId);
  await redis.hset(key, {
    revenue:   revenue.toFixed(2),
    orders:    String(orders),
    updatedAt: new Date().toISOString(),
  });
  await redis.expire(key, TTL_SECONDS);
}

export async function getHotMetrics(hotelId: string): Promise<HotMetrics | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  const raw = await redis.hgetall(hotKey(hotelId));
  if (!raw || !raw.revenue) return null;

  return {
    revenue:   parseFloat(raw.revenue),
    orders:    parseInt(raw.orders, 10),
    updatedAt: raw.updatedAt,
  };
}

// ─── Revenue leaderboard (sorted set: score=revenue, member=productId|name) ───

export async function upsertLeaderboard(
  hotelId: string,
  date:    string,
  items:   IItemMetric[],
): Promise<void> {
  const redis = getRedisClient();
  if (!redis || items.length === 0) return;

  const key      = leaderboardKey(hotelId, date);
  const pipeline = redis.pipeline();

  pipeline.del(key);
  for (const item of items) {
    const member = `${item.productId.toString()}|${item.productName}`;
    pipeline.zadd(key, item.revenue, member);
  }
  pipeline.expire(key, TTL_SECONDS);

  await pipeline.exec();
}

export interface LeaderboardEntry {
  productId:   string;
  productName: string;
  revenue:     number;
}

export async function getTopItems(
  hotelId: string,
  date:    string,
  limit:   number = 10,
): Promise<LeaderboardEntry[]> {
  const redis = getRedisClient();
  if (!redis) return [];

  const raw = await redis.zrevrange(leaderboardKey(hotelId, date), 0, limit - 1, 'WITHSCORES');
  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < raw.length; i += 2) {
    const [productId, productName] = raw[i].split('|');
    entries.push({
      productId:   productId ?? '',
      productName: productName ?? '',
      revenue:     parseFloat(raw[i + 1] ?? '0'),
    });
  }

  return entries;
}
