import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis';

export const makeRateLimiter = (opts: Partial<Options>) => {
  const redis = getRedisClient();
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
    ...opts,
  });
};
