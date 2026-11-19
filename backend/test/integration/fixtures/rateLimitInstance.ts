/**
 * A standalone "application instance" for the cross-process rate-limit test.
 * Each child process has its own Express app, its own limiter + memory store and
 * its own Redis connection — the ONLY thing shared between instances is Redis.
 * Prints "PORT <n>" once listening.
 */
import express from 'express';
import { Redis } from 'ioredis';
import { makeRateLimiter } from '../../../src/utils/rateLimiter';

const client = new Redis(process.env.RL_REDIS_URL!, { enableOfflineQueue: false, lazyConnect: true, maxRetriesPerRequest: 1 });

(async () => {
  await client.connect();
  const app = express();
  app.use(makeRateLimiter({
    name: process.env.RL_NAME || 'xproc',
    windowMs: 60_000,
    max: Number(process.env.RL_MAX || 5),
    redisClient: () => client as any,
    keyGenerator: () => 'same-client',
    validate: false,
  }));
  app.get('/', (_req, res) => { res.send('ok'); });
  const srv = app.listen(0, () => {
    process.stdout.write(`PORT ${(srv.address() as any).port}\n`);
  });
  process.on('SIGTERM', () => { srv.close(); client.disconnect(); process.exit(0); });
})();
