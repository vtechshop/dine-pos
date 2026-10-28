/**
 * Shared (Redis-backed) rate limiting — audit 2026-10, phase 3.
 *
 * Needs a real Redis server (no mock): REDIS_TEST_URL, or a local `redis-server`
 * binary (REDIS_SERVER_BIN, PATH, or C:\Program Files\Redis) which is started on a
 * random port and stopped afterwards. Set REQUIRE_REDIS_TESTS=1 (CI) to FAIL
 * instead of skipping when no Redis is available.
 */
import { startDb, stopDb, clearDb, makeApp } from './harness';

jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Redis } from 'ioredis';
import { makeRateLimiter, SharedRateLimitStore, RateLimitRedisClient } from '../../src/utils/rateLimiter';

jest.setTimeout(120_000);

// ── Disposable Redis ──────────────────────────────────────────────────────────
function findRedisBinary(): string | null {
  const candidates = [
    process.env.REDIS_SERVER_BIN,
    'C:\\Program Files\\Redis\\redis-server.exe',
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['redis-server'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
    return out || null;
  } catch { return null; }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

let redisUrl = process.env.REDIS_TEST_URL || '';
let redisProc: ChildProcess | null = null;
let redisAvailable = false;

async function waitForRedis(url: string): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const c = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    try { await c.connect(); await c.ping(); c.disconnect(); return true; } catch { c.disconnect(); }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

beforeAll(async () => {
  await startDb();
  if (!redisUrl) {
    const bin = findRedisBinary();
    if (bin) {
      const port = await freePort();
      redisProc = spawn(bin, ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
      redisUrl = `redis://127.0.0.1:${port}`;
    }
  }
  // Safety: these tests delete rl:* keys — only ever against a local Redis.
  if (redisUrl) {
    const host = new URL(redisUrl).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(`Refusing to run rate-limit tests against non-local Redis host "${host}"`);
    }
  }
  redisAvailable = !!redisUrl && await waitForRedis(redisUrl);
  if (!redisAvailable) {
    if (process.env.REQUIRE_REDIS_TESTS === '1') throw new Error('REQUIRE_REDIS_TESTS=1 but no Redis server is available');
    // eslint-disable-next-line no-console
    console.warn('[rateLimitShared] SKIPPED — no Redis available (set REDIS_TEST_URL or install redis-server).');
  }
});

afterAll(async () => {
  await stopDb();
  if (redisProc) redisProc.kill();
});

afterEach(async () => {
  await clearDb();
  // Delete only this test's keys — never FLUSHALL a Redis we did not start.
  if (redisAvailable) {
    const c = new Redis(redisUrl);
    const keys = await c.keys('rl:*');
    if (keys.length) await c.del(...keys);
    c.disconnect();
  }
});

const itRedis = (name: string, fn: () => Promise<void>) =>
  test(name, async () => { if (!redisAvailable) return; await fn(); });

// ── 1. Cross-PROCESS: two separate application instances share one limit ─────
function startInstance(env: Record<string, string>): Promise<{ proc: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [
      '-r', require.resolve('ts-node/register/transpile-only'),
      path.join(__dirname, 'fixtures', 'rateLimitInstance.ts'),
    ], { env: { ...process.env, NODE_ENV: 'development', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('instance did not start: ' + out)), 60_000);
    proc.stdout!.on('data', d => {
      out += d.toString();
      const m = out.match(/PORT (\d+)/);
      if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]) }); }
    });
    proc.stderr!.on('data', d => { out += d.toString(); });
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`instance exited ${code}: ${out}`)); });
  });
}

describe('cross-instance enforcement (separate OS processes)', () => {
  itRedis('requests spread over two instances share one limit of 5', async () => {
    const env = { RL_REDIS_URL: redisUrl, RL_MAX: '5', RL_NAME: 'xproc-test' };
    const a = await startInstance(env);
    const b = await startInstance(env);
    try {
      const hit = (port: number) => request(`http://127.0.0.1:${port}`).get('/').then(r => r.status);
      // 3 on A + 2 on B = 5 allowed in total …
      const first = [await hit(a.port), await hit(a.port), await hit(a.port), await hit(b.port), await hit(b.port)];
      expect(first).toEqual([200, 200, 200, 200, 200]);
      // … the 6th is refused on EITHER instance (per-process limits would allow 5 each).
      expect(await hit(b.port)).toBe(429);
      expect(await hit(a.port)).toBe(429);
    } finally {
      a.proc.removeAllListeners('exit'); b.proc.removeAllListeners('exit');
      a.proc.kill(); b.proc.kill();
    }
  });
});

// ── 2. Real login route: limiter created BEFORE Redis connects still uses Redis ─
describe('admin login limits use Redis even though limiters load before connectRedis()', () => {
  itRedis('per-account limit is shared and normalised (case / whitespace)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.REDIS_URL = redisUrl;
    // Route module (and its limiters) load first — exactly like server.ts.
    const authRoutes = (await import('../../src/routes/authRoutes')).default;
    const redisCfg   = await import('../../src/config/redis');
    await redisCfg.connectRedis();
    const Hotel = (await import('../../src/models/Hotel')).default;
    await Hotel.create({
      hotelName: 'H', ownerName: 'O', phone: '9000000099', status: 'active',
      adminId: 'Owner01', adminPasswordHash: await bcrypt.hash('right-password', 4),
    });
    const app = makeApp([['/api/auth', authRoutes]]);
    app.set('trust proxy', true);        // like production (server.ts trusts the proxy hop)
    process.env.NODE_ENV = 'development'; // limiters skip in NODE_ENV=test
    try {
      const variants = ['Owner01', ' owner01 ', 'OWNER01', 'owner01'];
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const r = await request(app).post('/api/auth/login')
          .set('X-Forwarded-For', `10.0.0.${i}`) // different IPs: only the account limit can trigger
          .send({ userId: variants[i % variants.length], password: 'wrong' });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 20).every(s => s === 401)).toBe(true);
      expect(statuses[20]).toBe(429);

      // Counter lives in Redis (not process memory) under the account key.
      const c = new Redis(redisUrl);
      const keys = await c.keys('rl:auth:login:account:*');
      c.disconnect();
      expect(keys).toContain('rl:auth:login:account:acct:owner01');
    } finally {
      process.env.NODE_ENV = prevEnv;
      await redisCfg.closeRedis();
      delete process.env.REDIS_URL;
    }
  });

  test('unknown account and wrong password give the same response (no enumeration)', async () => {
    const authRoutes = (await import('../../src/routes/authRoutes')).default;
    const Hotel = (await import('../../src/models/Hotel')).default;
    await Hotel.create({
      hotelName: 'H', ownerName: 'O', phone: '9000000098', status: 'suspended',
      adminId: 'Owner02', adminPasswordHash: await bcrypt.hash('right-password', 4),
    });
    const app = makeApp([['/api/auth', authRoutes]]);
    const unknown = await request(app).post('/api/auth/login').send({ userId: 'nobody', password: 'x' });
    const wrong   = await request(app).post('/api/auth/login').send({ userId: 'Owner02', password: 'x' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body); // status "suspended" is NOT revealed without the password
    const right = await request(app).post('/api/auth/login').send({ userId: 'Owner02', password: 'right-password' });
    expect(right.status).toBe(403); // correct password → real status shown
  });
});

// ── 3. Redis failure policy and recovery ─────────────────────────────────────
describe('Redis failure policy', () => {
  function appWith(getClient: () => RateLimitRedisClient | null, max = 3) {
    const app = express();
    app.use(makeRateLimiter({ name: `fail-${Math.random()}`, windowMs: 60_000, max, redisClient: getClient, keyGenerator: () => 'k', validate: false }));
    app.get('/', (_q, r) => { r.send('ok'); });
    return app;
  }

  test('Redis erroring → limiting continues per-instance (never disabled, never a lockout)', async () => {
    const broken: RateLimitRedisClient = {
      status: 'ready',
      eval: async () => { throw new Error('ECONNRESET'); },
      decr: async () => { throw new Error('ECONNRESET'); },
      del:  async () => { throw new Error('ECONNRESET'); },
    };
    const app = appWith(() => broken, 3);
    const s = [];
    for (let i = 0; i < 4; i++) s.push((await request(app).get('/')).status);
    expect(s).toEqual([200, 200, 200, 429]);
  });

  test('Redis not ready (reconnecting) → local fallback without calling Redis', async () => {
    const evalSpy = jest.fn();
    const app = appWith(() => ({ status: 'reconnecting', eval: evalSpy, decr: jest.fn(), del: jest.fn() } as any), 2);
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
    expect(evalSpy).not.toHaveBeenCalled();
  });

  itRedis('after an outage, counting moves back to Redis automatically', async () => {
    const real = new Redis(redisUrl);
    let healthy = false;
    const flaky: RateLimitRedisClient = {
      get status() { return healthy ? 'ready' : 'reconnecting'; },
      eval: (...a: any[]) => (real as any).eval(...a),
      decr: k => real.decr(k),
      del:  k => real.del(k),
    };
    const store = new SharedRateLimitStore({ name: 'recover', getClient: () => flaky });
    store.init({ windowMs: 60_000 } as any);
    try {
      await store.increment('k');                 // outage → local only
      expect(await real.get('rl:recover:k')).toBeNull();
      healthy = true;                             // Redis back
      const r = await store.increment('k');
      expect(r.totalHits).toBe(1);
      expect(await real.get('rl:recover:k')).toBe('1');
    } finally {
      store.shutdown();
      real.disconnect();
    }
  });

  itRedis('two limiters with the same name share a counter; different names do not', async () => {
    const c1 = new Redis(redisUrl);
    const c2 = new Redis(redisUrl);
    await Promise.all([c1.ping(), c2.ping()]); // wait until both are 'ready'
    const s1 = new SharedRateLimitStore({ name: 'same', getClient: () => c1 as any });
    const s2 = new SharedRateLimitStore({ name: 'same', getClient: () => c2 as any });
    const s3 = new SharedRateLimitStore({ name: 'other', getClient: () => c2 as any });
    [s1, s2, s3].forEach(s => s.init({ windowMs: 60_000 } as any));
    try {
      await s1.increment('ip');
      await s1.increment('ip');
      expect((await s2.increment('ip')).totalHits).toBe(3);
      expect((await s3.increment('ip')).totalHits).toBe(1);
    } finally {
      [s1, s2, s3].forEach(s => s.shutdown());
      c1.disconnect(); c2.disconnect();
    }
  });
});
