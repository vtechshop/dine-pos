/**
 * Integration test harness — real Express routers against a real (in-memory)
 * MongoDB replica set, so transactions, unique indexes and atomic updates are
 * exercised for real. No external services are contacted.
 *
 * Import this module FIRST in a test file: it sets env vars that
 * middleware/auth.ts reads at load time.
 *
 * Each test file must also mock '../../src/server' (routes import `io` from it,
 * and importing the real server would boot the whole app).
 */
process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789abcdef';

import mongoose from 'mongoose';
import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { sanitizeRequest } from '../../src/utils/sanitizeRequest';

// Normally one shared replica set is started by globalSetup.ts (IT_MONGO_URI).
// Fallback: start a private one if the file is run without the global setup.
let ownRepl: MongoMemoryReplSet | null = null;

export async function startDb(): Promise<void> {
  let uri = process.env.IT_MONGO_URI;
  if (!uri) {
    ownRepl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    uri = ownRepl.getUri();
  }
  // Safety: integration tests drop/clear data — only ever against a local server.
  const host = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing to run integration tests against non-local MongoDB host "${host}"`);
  }
  // Separate database per test file so parallel workers never share data.
  const dbName = `it_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(uri, { dbName });
  // Build every registered model's indexes (partial unique indexes matter for idempotency).
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
}

export async function stopDb(): Promise<void> {
  try { await mongoose.connection.db?.dropDatabase(); } catch { /* ignore */ }
  await mongoose.disconnect();
  if (ownRepl) await ownRepl.stop();
  ownRepl = null;
}

export async function clearDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map(c => c.deleteMany({})));
}

/** Minimal app mirroring server.ts body parsing + the global operator guard. */
export function makeApp(mounts: Array<[string, Router]>): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeRequest);
  for (const [path, router] of mounts) app.use(path, router);
  return app;
}

type Role = 'admin' | 'waiter' | 'cashier' | 'kitchen';

export function tokenFor(hotelId: unknown, role: Role = 'admin', extra: Record<string, unknown> = {}): string {
  return jwt.sign({ hotelId, role, hotelName: 'Test Hotel', ...extra }, process.env.JWT_SECRET!, { expiresIn: '15m' });
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let phoneSeq = 9000000000;

export async function createHotel(overrides: Record<string, unknown> = {}) {
  const Hotel = (await import('../../src/models/Hotel')).default;
  return Hotel.create({
    hotelName: 'Test Hotel',
    ownerName: 'Owner',
    phone:     String(phoneSeq++),
    status:    'active',
    subscriptionType: 'standard',
    subscriptionEndDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    ...overrides,
  });
}

export async function createProduct(hotelId: unknown, overrides: Record<string, unknown> = {}) {
  const Product = (await import('../../src/models/Product')).default;
  const Category = (await import('../../src/models/Category')).default;
  const cat = await Category.create({ hotelId, name: `Cat ${Math.random()}` });
  return Product.create({
    hotelId, name: 'Paneer Tikka', price: 200, taxPercent: 5,
    category: cat._id, isAvailable: true, isDeleted: false, stock: -1,
    ...overrides,
  });
}
