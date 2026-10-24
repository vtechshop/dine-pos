import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis';

/**
 * `distributed: false` keeps counters in-process. Use it for high-traffic
 * routes where the limit only guards against runaway clients: a Redis store
 * costs one round-trip per request, and Redis is far from the API region.
 * Limits then apply per instance (up to maxInstances× looser at peak).
 * Keep the default (Redis) for auth / brute-force / cost-control limiters.
 */
export const makeRateLimiter = (opts: Partial<Options> & { distributed?: boolean }) => {
  const { distributed = true, ...rest } = opts;
  const redis = distributed ? getRedisClient() : null;
  if (!distributed) {
    return rateLimit({ standardHeaders: true, legacyHeaders: false, ...rest });
  }
  if (!redis) {
    // M-3: In-memory rate limiter is per-process. With multiple Render instances,
    // each worker has its own counter so a client can exceed the limit by spreading
    // requests across instances. Log once so operators know Redis is needed for
    // accurate rate limiting in a multi-worker deployment.
    console.warn(
      '[rateLimiter] Redis unavailable — falling back to in-memory store. ' +
      'Rate limits are per-process and will not be enforced across multiple workers. ' +
      'Set REDIS_URL in your environment to enable cluster-wide rate limiting.',
    );
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...(redis
      ? {
          store: new RedisStore({
            sendCommand: (...args: string[]) => (redis as any).call(...args),
          }),
        }
      : {}),
    ...rest,
  });
};
