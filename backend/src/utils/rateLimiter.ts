import rateLimit, { MemoryStore, Options, Store, IncrementResponse } from 'express-rate-limit';
import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// ── Shared (cross-instance) rate limiting ─────────────────────────────────────
//
// Root cause of the old behaviour: limiters are created when route modules load,
// which is BEFORE server.ts calls connectRedis(). The old factory checked
// getRedisClient() once at creation time, got null, and every limiter silently
// used a per-process memory store — even with REDIS_URL set and 3 instances.
//
// SharedRateLimitStore resolves the Redis client on EVERY request, so limiters
// become shared as soon as Redis is connected.
//
// Failure policy (deliberate):
//   • REDIS_URL not set      → per-instance memory counting (single-instance /
//                              dev only; multi-instance production must set it).
//   • Redis set but failing  → FAIL-LOCAL: count in this instance's memory for
//                              the duration of the outage. Limiting is never
//                              disabled (no fail-open) and staff are never locked
//                              out by the outage itself (no fail-closed).
//                              Logged at most once per minute per limiter.
//   • Redis recovers         → shared counting resumes automatically.
//
// Counting is a fixed window, atomic in Redis (INCR + PEXPIRE in one Lua call),
// so concurrent requests on different instances cannot race the counter.

const INCR_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

/** Minimal client surface we need (ioredis-compatible). */
export interface RateLimitRedisClient {
  status?: string;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  decr(key: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class SharedRateLimitStore implements Store {
  /** Keys live in Redis, not in this process (tells express-rate-limit not to warn). */
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private readonly memory = new MemoryStore();
  private readonly getClient: () => RateLimitRedisClient | null;
  private lastFailureLog = 0;

  constructor(opts: { name: string; getClient?: () => RateLimitRedisClient | null }) {
    this.prefix = `rl:${opts.name}:`;
    this.getClient = opts.getClient ?? (() => getRedisClient() as unknown as RateLimitRedisClient | null);
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  private readyClient(): RateLimitRedisClient | null {
    const c = this.getClient();
    // ioredis exposes `status`; anything other than 'ready' cannot serve commands
    // (enableOfflineQueue is false), so go straight to the local fallback.
    if (!c || (c.status !== undefined && c.status !== 'ready')) return null;
    return c;
  }

  private logFailure(err: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLog < 60_000) return;
    this.lastFailureLog = now;
    logger.error('[rateLimiter] Redis error — using per-instance fallback until Redis recovers', {
      limiter: this.prefix, err: String(err),
    });
  }

  async increment(key: string): Promise<IncrementResponse> {
    const client = this.readyClient();
    if (client) {
      try {
        const res = await client.eval(INCR_SCRIPT, 1, this.prefix + key, String(this.windowMs)) as [number, number];
        const hits = Number(res[0]);
        const ttl  = Number(res[1]);
        return { totalHits: hits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
      } catch (err) {
        this.logFailure(err);
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const client = this.readyClient();
    if (client) {
      try { await client.decr(this.prefix + key); return; } catch (err) { this.logFailure(err); }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const client = this.readyClient();
    if (client) {
      try { await client.del(this.prefix + key); } catch (err) { this.logFailure(err); }
    }
    await this.memory.resetKey(key);
  }

  shutdown(): void {
    this.memory.shutdown();
  }
}

/** Derives a stable limiter name from the caller's source location when none is given. */
function callerName(): string {
  const line = (new Error().stack ?? '').split('\n')[3] ?? '';
  const m = line.match(/([\w.-]+)\.[tj]s:(\d+)/);
  return m ? `${m[1]}:${m[2]}` : 'anon';
}

let warnedNoRedisUrl = false;

export type RateLimiterOptions = Partial<Options> & {
  /** Unique, stable name — becomes the Redis key prefix. Required for auth limiters. */
  name?: string;
  /**
   * false keeps counters in-process. Use it for high-traffic routes where the
   * limit only guards against runaway clients: the shared store costs one Redis
   * round-trip per request, and Redis is far from the API region. Limits then
   * apply per instance. Keep the default (shared) for auth / brute-force /
   * cost-control limiters.
   */
  distributed?: boolean;
  /** Test seam: supply the Redis client explicitly. */
  redisClient?: () => RateLimitRedisClient | null;
};

export const makeRateLimiter = (opts: RateLimiterOptions) => {
  const { name, redisClient, distributed = true, ...rest } = opts;
  if (!distributed) {
    return rateLimit({ standardHeaders: true, legacyHeaders: false, ...rest });
  }
  if (!process.env.REDIS_URL && !redisClient && !warnedNoRedisUrl && process.env.NODE_ENV !== 'test') {
    warnedNoRedisUrl = true;
    console.warn(
      '[rateLimiter] REDIS_URL not set — rate limits are per-process. ' +
      'Set REDIS_URL when running more than one instance.',
    );
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    store: new SharedRateLimitStore({ name: name ?? callerName(), getClient: redisClient }),
    ...rest,
  });
};
