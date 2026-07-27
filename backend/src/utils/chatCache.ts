// ─── AI Chat Cache ────────────────────────────────────────────────────────────
// Conversation history: per (hotelId, sessionId), 24h TTL.
// Business context: per hotelId, 30min TTL (refreshes when data changes).

import { getRedisClient } from '../config/redis';

export interface StoredMessage {
  role:      'user' | 'assistant';
  content:   string;
  timestamp: string;
}

// ── Key helpers ───────────────────────────────────────────────────────────────

const historyKey  = (hotelId: string, sessionId: string) =>
  `dinepos:ai:chat:hist:${hotelId}:${sessionId}`;

const contextKey  = (hotelId: string) =>
  `dinepos:ai:chat:ctx:${hotelId}`;

const sessionsKey = (hotelId: string) =>
  `dinepos:ai:chat:sessions:${hotelId}`;

// TTLs
const HISTORY_TTL = 24 * 60 * 60;   // 24h — conversation lifespan
const CONTEXT_TTL = 30 * 60;         // 30min — business context refresh window
const SESSION_TTL = 24 * 60 * 60;   // 24h — session list lifespan

// ── Conversation history ──────────────────────────────────────────────────────

export async function getHistory(
  hotelId:   string,
  sessionId: string,
): Promise<StoredMessage[]> {
  const redis = getRedisClient();
  if (!redis) return [];
  try {
    const raw = await redis.get(historyKey(hotelId, sessionId));
    return raw ? (JSON.parse(raw) as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

export async function appendHistory(
  hotelId:   string,
  sessionId: string,
  messages:  StoredMessage[],
  maxMessages: number = 20,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const existing = await getHistory(hotelId, sessionId);
    const updated  = [...existing, ...messages].slice(-maxMessages); // keep last N
    await redis.setex(historyKey(hotelId, sessionId), HISTORY_TTL, JSON.stringify(updated));
    // Track session ID in hotel's session set
    await redis.sadd(sessionsKey(hotelId), sessionId);
    await redis.expire(sessionsKey(hotelId), SESSION_TTL);
  } catch { /* best-effort */ }
}

export async function clearHistory(
  hotelId:   string,
  sessionId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(historyKey(hotelId, sessionId));
    await redis.srem(sessionsKey(hotelId), sessionId);
  } catch { /* best-effort */ }
}

export async function listSessions(hotelId: string): Promise<string[]> {
  const redis = getRedisClient();
  if (!redis) return [];
  try {
    return await redis.smembers(sessionsKey(hotelId));
  } catch {
    return [];
  }
}

// ── Business context cache ────────────────────────────────────────────────────

export async function getCachedContext(hotelId: string): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    return await redis.get(contextKey(hotelId));
  } catch {
    return null;
  }
}

export async function setCachedContext(hotelId: string, context: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.setex(contextKey(hotelId), CONTEXT_TTL, context);
  } catch { /* best-effort */ }
}

export async function invalidateContext(hotelId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(contextKey(hotelId));
  } catch { /* best-effort */ }
}
