/**
 * Audit (Phase 2) — critical security fixes, behavioural regression tests.
 *
 * SEC-01  NoSQL operator injection: "$"-keys are stripped from request input.
 * SEC-02  Staff PIN login rejects a non-ObjectId / object hotelId (400) before
 *         any query runs or a JWT is signed.
 * SEC-03  authMiddleware rejects a JWT whose hotelId is not a 24-hex string.
 * PAY-01  /qr-verify: a successful payment for order A cannot release order B
 *         (crash-recovery branch previously released any client-supplied order).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-audit-regression-tests-0123456789';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/server', () => ({
  io: { to: () => ({ emit: jest.fn() }) },
}));
jest.mock('../../src/utils/printUtils', () => ({
  scheduleKOTPrint: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/models/Payment', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/Order', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/Hotel', () => ({
  __esModule: true,
  default: { findById: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../src/models/Waiter', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), exists: jest.fn() },
}));
jest.mock('../../src/models/Cashier', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), exists: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import PaymentModel from '../../src/models/Payment';
import OrderModel from '../../src/models/Order';
import HotelModel from '../../src/models/Hotel';
import WaiterModel from '../../src/models/Waiter';
import { stripOperators, sanitizeRequest } from '../../src/utils/sanitizeRequest';
import { authMiddleware } from '../../src/middleware/auth';

// ── helpers ─────────────────────────────────────────────────────────────────

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json   = jest.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

/** Last handler of an Express router route (skips limiter middleware). */
function routeHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any, next?: any) => Promise<unknown>;
}

const HOTEL_A = '64b7f0c2a1b2c3d4e5f60718';
const ORDER_A = '64b7f0c2a1b2c3d4e5f60aaa';
const ORDER_B = '64b7f0c2a1b2c3d4e5f60bbb';

beforeEach(() => jest.clearAllMocks());

// ── SEC-01 ──────────────────────────────────────────────────────────────────

describe('SEC-01 — request input cannot carry MongoDB operators', () => {
  it('removes $-keys at any depth and keeps normal fields', () => {
    const body = {
      hotelId: { $ne: '000000000000000000000000' },
      employeeCode: 'W01',
      nested: { a: 1, $where: 'sleep(1000)', deep: [{ $gt: 0, ok: true }] },
    };
    stripOperators(body);
    expect(body.hotelId).toEqual({});
    expect(body.employeeCode).toBe('W01');
    expect(body.nested).toEqual({ a: 1, deep: [{ ok: true }] });
  });

  it('middleware sanitises body, query and params and calls next()', () => {
    const req: any = { body: { x: { $ne: 1 } }, query: { table: { $ne: 'x' } }, params: { id: 'abc' } };
    const next = jest.fn();
    sanitizeRequest(req, {} as any, next);
    expect(req.body.x).toEqual({});
    expect(req.query.table).toEqual({});
    expect(req.params.id).toBe('abc');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ── SEC-02 ──────────────────────────────────────────────────────────────────

describe('SEC-02 — staff PIN login rejects non-ObjectId hotelId', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authRouter = require('../../src/routes/authRoutes').default;

  for (const path of ['/waiter', '/cashier']) {
    it(`${path}: object hotelId → 400, no DB lookup, no token`, async () => {
      const res = mockRes();
      await routeHandler(authRouter, 'post', path)(
        { body: { hotelId: { $ne: '000000000000000000000000' }, employeeCode: 'W01', pin: '1234' }, ip: '1.1.1.1' },
        res,
      );
      expect(res.statusCode).toBe(400);
      expect(HotelModel.findById).not.toHaveBeenCalled();
      expect(WaiterModel.findOne).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    });

    it(`${path}: non-hex string hotelId → 400`, async () => {
      const res = mockRes();
      await routeHandler(authRouter, 'post', path)(
        { body: { hotelId: 'not-an-id', employeeCode: 'W01', pin: '1234' }, ip: '1.1.1.1' },
        res,
      );
      expect(res.statusCode).toBe(400);
    });
  }

  it('/kitchen: object pin → 400', async () => {
    const res = mockRes();
    await routeHandler(authRouter, 'post', '/kitchen')(
      { body: { hotelId: HOTEL_A, pin: { $gt: '' } }, ip: '1.1.1.1' },
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

// ── SEC-03 ──────────────────────────────────────────────────────────────────

describe('SEC-03 — authMiddleware rejects tokens with a non-ObjectId hotelId', () => {
  it('object hotelId in a validly-signed JWT → 401, next() not called', async () => {
    const token = jwt.sign({ hotelId: { $ne: '000000000000000000000000' }, role: 'waiter' }, process.env.JWT_SECRET!);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.hotelId).toBeUndefined();
  });
});

// ── PAY-01 ──────────────────────────────────────────────────────────────────

describe('PAY-01 — qr-verify cannot release an order the payment does not belong to', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const paymentRouter = require('../../src/routes/publicPaymentRoutes').default;
  const handler = routeHandler(paymentRouter, 'post', '/qr-verify');

  const baseBody = {
    razorpay_payment_id: 'pay_x', razorpay_order_id: 'order_x', razorpay_signature: 'sig',
    internalTransactionId: 'txn_A', hotelId: HOTEL_A,
  };

  it('successful payment of order A + orderId B → 422, order B untouched', async () => {
    (PaymentModel.findOne as jest.Mock).mockResolvedValue({
      status: 'success', orderId: { toString: () => ORDER_A }, gatewayTransactionId: 'pay_x',
    });
    const res = mockRes();
    await handler({ body: { ...baseBody, orderId: ORDER_B } }, res);
    expect(res.statusCode).toBe(422);
    expect(OrderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('crash recovery still releases the payment’s own order A', async () => {
    (PaymentModel.findOne as jest.Mock).mockResolvedValue({
      status: 'success', orderId: { toString: () => ORDER_A }, gatewayTransactionId: 'pay_x',
    });
    // releasePaidOnlineOrder reads the order first; it is still payment_pending and
    // not on a table, so the atomic release (findOneAndUpdate) runs for ORDER_A.
    (OrderModel.findOne as jest.Mock).mockReturnValue({ lean: async () => ({ _id: ORDER_A, status: 'payment_pending' }) });
    (OrderModel.findOneAndUpdate as jest.Mock).mockResolvedValue(null); // already released
    const res = mockRes();
    await handler({ body: { ...baseBody, orderId: ORDER_A } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    const filter = (OrderModel.findOneAndUpdate as jest.Mock).mock.calls[0][0];
    expect(String(filter._id)).toBe(ORDER_A);
  });

  it('object internalTransactionId → 400 before any lookup', async () => {
    const res = mockRes();
    await handler({ body: { ...baseBody, internalTransactionId: { $ne: null }, orderId: ORDER_B } }, res);
    expect(res.statusCode).toBe(400);
    expect(PaymentModel.findOne).not.toHaveBeenCalled();
  });
});

// ── PRINT-01 ────────────────────────────────────────────────────────────────

describe('PRINT-01 — printer reconnect never re-sends single-mode audit receipts', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { flushablePrintJobsFilter } = require('../../src/utils/printFlush');

  it('excludes printerMode=single jobs and keeps the pending/failed retry rules', () => {
    const since = new Date('2026-10-27T00:00:00Z');
    const f = flushablePrintJobsFilter(HOTEL_A, 'cashier', since);
    expect(f.printerMode).toEqual({ $ne: 'single' });
    expect(f.printerTarget).toBe('cashier');
    expect(String(f.hotelId)).toBe(HOTEL_A);
    expect(f.createdAt).toEqual({ $gte: since });
    expect(f.$or).toEqual([
      { status: 'pending' },
      { status: 'failed', attemptCount: { $lt: 3 } },
    ]);
  });

  it('matches against a single-mode pending receipt the way MongoDB would ($ne)', () => {
    const f = flushablePrintJobsFilter(HOTEL_A, 'cashier', new Date(0));
    const job = { printerMode: 'single', status: 'pending' };
    const passesModeFilter = job.printerMode !== f.printerMode.$ne;
    expect(passesModeFilter).toBe(false);
  });
});
