import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

let _client: Redis | null = null;
// Tracks the Socket.IO adapter subscriber created by server.ts so closeRedis()
// can quit it alongside the publisher, preventing orphaned connections on shutdown.
let _subClient: Redis | null = null;

export const getRedisClient = (): Redis | null => _client;

// Called by server.ts after creating the Socket.IO adapter sub-client so this
// module owns the full cleanup lifecycle for all Redis connections.
export const registerSubClient = (client: Redis): void => {
  _subClient = client;
};

export const connectRedis = async (): Promise<void> => {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('REDIS_URL not set — running without Redis (in-memory mode)');
    return;
  }

  try {
    _client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis retry limit reached — giving up');
          return null; // stop retrying
        }
        return Math.min(times * 500, 5000);
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    _client.on('error', (err) => {
      logger.error('Redis connection error', { err: String(err) });
    });

    _client.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });

    await _client.connect();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable — falling back to in-memory adapter', { err: String(err) });
    _client = null;
  }
};

export const closeRedis = async (): Promise<void> => {
  // Sub-client (Socket.IO adapter subscriber) must be closed first; it uses its
  // own TCP connection independent of the main client.
  if (_subClient) {
    try { await _subClient.quit(); } catch { /* ignore — process is exiting */ }
    _subClient = null;
  }
  if (_client) {
    try {
      await _client.quit();
      logger.info('Redis connection closed');
    } catch { /* ignore — process is exiting */ }
    _client = null;
  }
};

export const redisHealthCheck = async (): Promise<'connected' | 'disconnected' | 'disabled'> => {
  if (!process.env.REDIS_URL) return 'disabled';
  if (!_client) return 'disconnected';
  try {
    const pong = await _client.ping();
    return pong === 'PONG' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
};
