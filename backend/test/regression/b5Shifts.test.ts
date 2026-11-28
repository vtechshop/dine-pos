// Phase 5 · Batch 5 (Shifts) — owner Decision 3: an open shift is mandatory before the counter
// takes money (cash, counter UPI, counter card, split). Online gateway payments are not affected.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Shift from '../../src/models/Shift';
import Order from '../../src/models/Order';
import { isCounterMethod, hasOpenShift, refuseWithoutShift, owesAtCounter, SHIFT_REQUIRED } from '../../src/utils/shiftGuard';

const hotelId = String(new mongoose.Types.ObjectId());
const src = (f: string) => fs.readFileSync(path.join(__dirname, '../../src/routes', f), 'utf8');
const fakeRes = () => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
};

afterEach(() => jest.restoreAllMocks());

describe('Batch 5: the shift rule', () => {
  it('counter methods need a shift; online gateway methods do not', () => {
    for (const m of ['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split']) expect(isCounterMethod(m)).toBe(true);
    for (const m of ['razorpay', 'online', 'complimentary', '', undefined]) expect(isCounterMethod(m)).toBe(false);
  });

  it('no open shift → 409 SHIFT_REQUIRED with a plain message; an open shift → nothing sent', async () => {
    const exists = jest.spyOn(Shift, 'exists').mockResolvedValueOnce(null as never).mockResolvedValueOnce({ _id: 'x' } as never);
    const r1 = fakeRes();
    expect(await refuseWithoutShift(r1, hotelId)).toBe(true);
    expect([r1.statusCode, r1.body]).toEqual([409, SHIFT_REQUIRED]);
    expect(SHIFT_REQUIRED.message).toMatch(/^Open a shift before taking payments/);
    const r2 = fakeRes();
    expect(await refuseWithoutShift(r2, hotelId)).toBe(false);
    expect(r2.statusCode).toBe(0);
    expect(exists.mock.calls[0][0]).toEqual({ hotelId: new mongoose.Types.ObjectId(hotelId), status: 'open' });
    expect(await hasOpenShift('not-an-id')).toBe(false);
  });

  it('a table / guest bill needs a shift only when something is still owed at the counter', async () => {
    const orders = (list: any[]) => jest.spyOn(Order, 'find').mockReturnValue({ select: () => ({ lean: () => Promise.resolve(list) }) } as never);
    orders([{ _id: 1, grandTotal: 252, amountSettled: 252, paymentTime: new Date(), status: 'served', paymentMethod: 'cash' }]);
    expect(await owesAtCounter(hotelId, {})).toBe(false);
    jest.restoreAllMocks();
    orders([{ _id: 2, grandTotal: 189, amountSettled: 0, paymentTime: null, status: 'served', paymentMethod: 'cash' }]);
    expect(await owesAtCounter(hotelId, {})).toBe(true);
  });
});

describe('Batch 5: every counter payment route checks the shift before it writes anything', () => {
  const before = (text: string, guard: string, firstWrite: string) => {
    const g = text.indexOf(guard);
    const w = text.indexOf(firstWrite, g >= 0 ? 0 : text.length);
    expect(g).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(g);
  };

  it('POST /orders with payNow — before the order is built', () => {
    const route = src('orderRoutes.ts').slice(src('orderRoutes.ts').indexOf("router.post('/', requireWaiterOrCashierOrAdmin"));
    before(route, 'isCounterMethod(req.body.paymentMethod) && await refuseWithoutShift(res, req.hotelId!)', 'new Order(');
  });

  it('POST /orders/:id/pay — before the order is read and paid', () => {
    const route = src('orderRoutes.ts').slice(src('orderRoutes.ts').indexOf("router.post('/:id/pay'"));
    before(route, 'if (await refuseWithoutShift(res, req.hotelId!)) return;', 'mongoose.startSession()');
  });

  it('PATCH /orders/:id/status → completed — before the order is completed', () => {
    const route = src('orderRoutes.ts').slice(src('orderRoutes.ts').indexOf("router.patch('/:id/status'"));
    before(route, 'if (takesCounterMoney && await refuseWithoutShift(res, req.hotelId!)) return;', '{ $set: completionFields }');
  });

  it('billing a guest and bulk-billing a table — before the bill is claimed', () => {
    before(src('guestRoutes.ts'), "await owesAtCounter(req.hotelId!, { sessionId: session._id, guestId: guest._id })", "status: 'billed',");
    before(src('sessionRoutes.ts'), 'await owesAtCounter(req.hotelId!, { sessionId: session._id })', 'billingClaimedAt: null');
  });

  it('online gateway routes are untouched (no shift rule)', () => {
    for (const f of ['publicPaymentRoutes.ts', 'paymentWebhookRoutes.ts', 'qrRoutes.ts']) expect(src(f)).not.toMatch(/refuseWithoutShift/);
  });
});
