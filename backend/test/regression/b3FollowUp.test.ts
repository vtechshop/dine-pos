// Phase 5 · Batch 3 follow-up (owner decision: tips are a separate collection, not sales) and the
// one drawer figure used by the dashboard, Shift tab, cash-out limit and shift close.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import PaymentEntry from '../../src/models/PaymentEntry';
import Order from '../../src/models/Order';
import { moneyMovements, drawerCash } from '../../src/utils/financeDefinitions';

const hotelId = new mongoose.Types.ObjectId();
const row = (type: string, method: string, amount: number) => ({ _id: { type, method }, amount });

function mockLedger(rows: ReturnType<typeof row>[]) {
  jest.spyOn(PaymentEntry, 'aggregate').mockResolvedValue(rows as never);
  // no legacy (pre-ledger) orders or refunds
  jest.spyOn(Order, 'find').mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) } as never);
}

afterEach(() => jest.restoreAllMocks());

describe('Batch 3 follow-up: tips in the payment ledger', () => {
  it('a tip entry is valid and never settles an order', () => {
    const e = new PaymentEntry({
      hotelId, type: 'tip', method: 'cash', amount: 20, paidAt: new Date(), source: 'tip',
      allocations: [{ orderId: new mongoose.Types.ObjectId(), amount: 20 }], idempotencyKey: 'tip:x',
    });
    expect(e.validateSync()).toBeUndefined();
    const src = fs.readFileSync(path.join(__dirname, '../../src/utils/paymentLedger.ts'), 'utf8');
    expect(src).toMatch(/if \(e\.type === 'tip'\) continue;/);
  });

  it('an order keeps how its tip was paid (cash, UPI or card only)', () => {
    const base = { hotelId, orderNumber: 'T1', items: [], subtotal: 0, taxTotal: 0, grandTotal: 0 };
    expect(new Order({ ...base, tipAmount: 20, tipMethod: 'upi' }).validateSync()?.errors?.tipMethod).toBeUndefined();
    expect(new Order({ ...base, tipAmount: 20, tipMethod: 'voucher' }).validateSync()?.errors?.tipMethod).toBeDefined();
  });

  it('tips are reported on their own — not in collections or net collections', async () => {
    mockLedger([row('payment', 'cash', 252), row('payment', 'upi', 189), row('tip', 'cash', 20), row('tip', 'upi', 10)]);
    const m = await moneyMovements(hotelId, new Date(0), new Date());
    expect(m.collections).toEqual({ cash: 252, upi: 189, card: 0, online: 0, other: 0, total: 441 });
    expect(m.tips).toEqual({ cash: 20, upi: 10, card: 0, online: 0, other: 0, total: 30 });
    expect(m.netCollections).toBe(441);
  });
});

describe('Batch 3 follow-up: one drawer figure for a shift', () => {
  it('opening + cash collected + cash tips − cash refunds − cash reversals + cash in − cash out, to the paisa', async () => {
    mockLedger([
      row('payment', 'cash', 1228.8), row('payment', 'upi', 548.8), row('payment', 'card', 499),
      row('tip', 'cash', 20), row('tip', 'upi', 10), row('refund', 'cash', 189), row('reversal', 'cash', 100.4),
      row('payment', 'voucher', 100),
    ]);
    const d = await drawerCash(hotelId, { openedAt: new Date(0), openingCash: 1000, cashIn: 200, cashOut: 50.5 });
    expect(d).toEqual({
      openingCash: 1000, cashCollected: 1228.8, cashRefunds: 189, cashReversals: 100.4, cashTips: 20,
      cashIn: 200, cashOut: 50.5, expected: 2108.9,   // 1000 + 1228.80 + 20 − 189 − 100.40 + 200 − 50.50
    });
  });

  it('the shift close and the live stats both use it (no separate order totals)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/shiftRoutes.ts'), 'utf8');
    expect(src.match(/drawerCash\(hid, shift, (now|shiftEnd)\)/g)).toHaveLength(2);
    expect(src).toMatch(/const expected = drawer\.expected;/);
    expect(src).not.toMatch(/Order\.aggregate/);
  });

  it('a hotel admin can open a shift (no cashier id is no longer a server error)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/shiftRoutes.ts'), 'utf8');
    // merged with main (27 Nov 2026): an admin without a cashier identity opens the shift as 'admin'
    expect(src).toMatch(/req\.cashierId\s+\|\| \(byAdmin \? 'admin' : ''\)/);
  });
});
