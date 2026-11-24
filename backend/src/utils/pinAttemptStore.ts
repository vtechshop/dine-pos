import { createHash } from 'crypto';
import { Redis } from 'ioredis';
import { ClientRateLimitInfo, MemoryStore, Options, Store } from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger';

// Staff PIN attempt counters.
// With REDIS_URL set, counters are global and an unavailable Redis fails closed (503).
// PIN_LIMIT_STORE=memory is an operator break-glass: limits become per-instance.
// The store never switches at runtime, so a hit and its release always use one backend.

// bcrypt runs on the event loop, so healthy Redis replies can be delayed under login load.
const COMMAND_DEADLINE_MS = 2000;

const INCREMENT_LUA = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}`;

// Never creates a key, so a release after expiry cannot leave a negative counter.
const RELEASE_LUA = `
local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
if hits <= 1 then
  redis.call('DEL', KEYS[1])
else
  redis.call('DECR', KEYS[1])
end
return 1`;

export class PinCounterUnavailableError extends Error {
  constructor() {
    super('PIN attempt counter unavailable');
    this.name = 'PinCounterUnavailableError';
  }
}

// Dedicated connection: no command replay and no effect on the shared client used
// by Socket.IO and caches. Each connection attempt uses a fresh client because the
// ioredis socketTimeout timer survives its own reconnects and kills the new socket.
let client: Redis | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

const openClient = (url: string): void => {
  const next = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
    socketTimeout: 5000,
    retryStrategy: () => null,
  });
  next.on('error', (err) => logger.warn('PIN limiter Redis error', { err: String(err) }));
  next.on('ready', () => { reconnectAttempts = 0; });
  next.once('end', () => {
    if (client !== next) return;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (client === next) openClient(url);
    }, Math.min(reconnectAttempts * 500, 5000));
    reconnectTimer.unref();
  });
  client = next;
  next.connect().catch(() => {});
};

export const connectPinLimiterRedis = (): void => {
  const url = process.env.REDIS_URL;
  if (!url || process.env.PIN_LIMIT_STORE === 'memory' || client) return;
  openClient(url);
};

export const closePinLimiterRedis = async (): Promise<void> => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const current = client;
  client = null;
  if (current) await current.quit().catch(() => current.disconnect());
};

// Promise.race cannot cancel a sent command, so a late success is reported to the caller.
const withDeadline = async <T>(work: Promise<T>, onLateSuccess?: () => void): Promise<T> => {
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new PinCounterUnavailableError());
    }, COMMAND_DEADLINE_MS);
  });
  work.then(() => { if (expired) onLateSuccess?.(); }, () => {});
  try {
    return await Promise.race([work, deadline]);
  } catch {
    throw new PinCounterUnavailableError();
  } finally {
    clearTimeout(timer);
  }
};

class RedisPinAttemptStore implements Store {
  readonly localKeys = false;
  private windowMs = 0;

  constructor(readonly prefix: string) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private redisKey(key: string) {
    return this.prefix + createHash('sha256').update(key).digest('hex');
  }

  private ready(): Redis {
    if (!client || client.status !== 'ready') throw new PinCounterUnavailableError();
    return client;
  }

  private release(redis: Redis, redisKey: string) {
    return redis.eval(RELEASE_LUA, 1, redisKey) as Promise<unknown>;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redis = this.ready();
    const redisKey = this.redisKey(key);
    const work = redis.eval(INCREMENT_LUA, 1, redisKey, String(this.windowMs)) as Promise<[number, number]>;
    // The PIN is not checked after a timeout, so a late hit must not count.
    const [totalHits, ttl] = await withDeadline(work, () => {
      this.release(redis, redisKey).catch(() => {});
    });
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string): Promise<void> {
    try {
      await withDeadline(this.release(this.ready(), this.redisKey(key)));
    } catch {
      logger.warn('PIN attempt not released; it expires with its window', { prefix: this.prefix });
    }
  }

  async resetKey(key: string): Promise<void> {
    await withDeadline(this.ready().del(this.redisKey(key)));
  }
}

export const createPinAttemptStore = (prefix: string): Store => {
  if (process.env.REDIS_URL && process.env.PIN_LIMIT_STORE !== 'memory') {
    return new RedisPinAttemptStore(prefix);
  }
  logger.warn('PIN limits are per-instance and NOT globally enforced', { prefix });
  return new MemoryStore();
};

export const failClosedPinGuard = (limiter: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) =>
    limiter(req, res, (err?: unknown) => {
      if (err instanceof PinCounterUnavailableError) {
        res.setHeader('Retry-After', '30');
        res.status(503).json({
          code: 'STAFF_LOGIN_TEMPORARILY_UNAVAILABLE',
          message: 'Staff login is temporarily unavailable. Please try again in 30 seconds.',
        });
        return;
      }
      next(err as any);
    });
