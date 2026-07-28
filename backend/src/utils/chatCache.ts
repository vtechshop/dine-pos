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

// Lua script: atomic read-modify-write for appendHistory.
// Eliminates the TOCTOU race where two concurrent requests both read the same
// baseline, both append, and the last writer silently discards the other's messages.
// Redis executes Lua scripts atomically — no other command can interleave.
const APPEND_LUA = `
local key     = KEYS[1]
local sessKey = KEYS[2]
local newJson = ARGV[1]
local maxMsg  = tonumber(ARGV[2])
local histTTL = tonumber(ARGV[3])
local sessTTL = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local msgs = {}
if raw then msgs = cjson.decode(raw) end

local newMsgs = cjson.decode(newJson)
for _, m in ipairs(newMsgs) do
  msgs[#msgs + 1] = m
end
while #msgs > maxMsg do
  table.remove(msgs, 1)
end

redis.call('SETEX', key, histTTL, cjson.encode(msgs))
redis.call('SADD',  sessKey, ARGV[5])
redis.call('EXPIRE', sessKey, sessTTL)
return #msgs
`;

export async function appendHistory(
  hotelId:     string,
  sessionId:   string,
  messages:    StoredMessage[],
  maxMessages: number = 20,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await (redis as any).eval(
      APPEND_LUA,
      2,
      historyKey(hotelId, sessionId),
      sessionsKey(hotelId),
      JSON.stringify(messages),
      maxMessages,
      HISTORY_TTL,
      SESSION_TTL,
      sessionId,
    );
  } catch { /* best-effort: Redis unavailable degrades to no history */ }
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
