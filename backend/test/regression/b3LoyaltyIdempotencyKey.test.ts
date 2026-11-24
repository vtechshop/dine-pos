// Phase 5 · Batch 3 — same root cause as P4-TBL-01. A unique sparse index still indexes an explicit
// null, so a keyless loyalty transaction must leave the field out, or only one can ever exist.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import LoyaltyTransaction from '../../src/models/LoyaltyTransaction';

describe('Batch 3: loyalty transactions without an idempotency key', () => {
  const base = () => ({
    customerId: new mongoose.Types.ObjectId(),
    hotelId: new mongoose.Types.ObjectId(),
    transactionType: 'adjust',
    points: 10,
    balanceAfter: 10,
  });

  it('does not store a null key by default', () => {
    const doc = new LoyaltyTransaction(base()).toObject() as unknown as Record<string, unknown>;
    expect('idempotencyKey' in doc).toBe(false);
  });

  it('keeps a real key', () => {
    const doc = new LoyaltyTransaction({ ...base(), idempotencyKey: 'org:earn:order' });
    expect(doc.idempotencyKey).toBe('org:earn:order');
  });

  it('no loyalty write sets the key to null', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/utils/loyaltyUtils.ts'), 'utf8');
    expect(src).not.toMatch(/idempotencyKey:\s*null/);
    expect(src).not.toMatch(/:(earn|redeem):[^\n]*\r?\n\s*:\s*null/);
  });
});
