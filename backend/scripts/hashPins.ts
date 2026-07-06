/**
 * One-time migration: hash all plain-text PINs in MongoDB.
 * Run ONCE before deploying the bcrypt login changes.
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/hashPins.ts
 *
 * The script is idempotent — already-hashed PINs (starting with $2b$) are skipped.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const SALT_ROUNDS = 12;
const BCRYPT_PREFIX = /^\$2[ab]\$/;

async function hashWaiters(): Promise<void> {
  const Waiter = (await import('../src/models/Waiter')).default;
  const waiters = await (Waiter as any).find({ hotelId: { $exists: true } }).lean();
  let hashed = 0;
  for (const w of waiters as any[]) {
    if (!w.pin || BCRYPT_PREFIX.test(w.pin)) continue;
    const newHash = await bcrypt.hash(w.pin, SALT_ROUNDS);
    await (Waiter as any).findByIdAndUpdate(w._id, { pin: newHash });
    console.log(`  ✓ Waiter ${w.name} (${w.employeeCode})`);
    hashed++;
  }
  console.log(`Waiters: ${hashed} hashed, ${waiters.length - hashed} already hashed or skipped.`);
}

async function hashCashiers(): Promise<void> {
  const Cashier = (await import('../src/models/Cashier')).default;
  const cashiers = await (Cashier as any).find({ hotelId: { $exists: true } }).lean();
  let hashed = 0;
  for (const c of cashiers as any[]) {
    if (!c.pin || BCRYPT_PREFIX.test(c.pin)) continue;
    const newHash = await bcrypt.hash(c.pin, SALT_ROUNDS);
    await (Cashier as any).findByIdAndUpdate(c._id, { pin: newHash });
    console.log(`  ✓ Cashier ${c.name} (${c.employeeCode})`);
    hashed++;
  }
  console.log(`Cashiers: ${hashed} hashed, ${cashiers.length - hashed} already hashed or skipped.`);
}

async function hashKitchenPins(): Promise<void> {
  const Settings = (await import('../src/models/Settings')).default;
  const settings = await (Settings as any).find({ kitchenPin: { $exists: true, $ne: '' } }).lean();
  let hashed = 0;
  for (const s of settings as any[]) {
    if (!s.kitchenPin || BCRYPT_PREFIX.test(s.kitchenPin)) continue;
    const newHash = await bcrypt.hash(s.kitchenPin, SALT_ROUNDS);
    await (Settings as any).findByIdAndUpdate(s._id, { kitchenPin: newHash });
    console.log(`  ✓ Kitchen PIN for hotel ${s.hotelId}`);
    hashed++;
  }
  console.log(`Kitchen PINs: ${hashed} hashed, ${settings.length - hashed} already hashed or skipped.`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('Connected.\n');

  console.log('─── Hashing Waiter PINs ───────────────────');
  await hashWaiters();

  console.log('\n─── Hashing Cashier PINs ──────────────────');
  await hashCashiers();

  console.log('\n─── Hashing Kitchen PINs ──────────────────');
  await hashKitchenPins();

  console.log('\n✅ Migration complete. All plain-text PINs are now hashed.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
