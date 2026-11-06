/**
 * Baseline checks for phase-1 protections that had no behavioural test yet:
 *   - live-order socket room access control (#7)
 *   - branch-code uniqueness index (#8)
 *   - INR-only on the staff payment route (#3)
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';

jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import request from 'supertest';
import mongoose from 'mongoose';
import Hotel from '../../src/models/Hotel';
import Order from '../../src/models/Order';
import Payment from '../../src/models/Payment';
import paymentRoutes from '../../src/routes/paymentRoutes';
import { resolveJoinHotelRooms } from '../../src/utils/socketRooms';

jest.setTimeout(60_000);

const app = makeApp([['/api/payments', paymentRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

describe('#7 live-order socket rooms', () => {
  const A = new mongoose.Types.ObjectId().toString();
  const B = new mongoose.Types.ObjectId().toString();

  test('anonymous socket joins only the public room (no PII rooms)', () => {
    const d = resolveJoinHotelRooms({}, A);
    expect(d.rooms).toEqual([`public_${A}`]);
    expect(d.rooms.some(r => r.startsWith('hotel_') || r.startsWith('admin_'))).toBe(false);
  });

  test('authenticated socket joins its own hotel rooms', () => {
    expect(resolveJoinHotelRooms({ authenticated: true, hotelId: A }, A).rooms).toEqual([`hotel_${A}`, `admin_${A}`]);
  });

  test('authenticated socket cannot join another hotel', () => {
    const d = resolveJoinHotelRooms({ authenticated: true, hotelId: A }, B);
    expect(d.rooms).toEqual([]);
    expect(d.rejected).toBe('mismatch');
  });

  test('anonymous socket with a malformed or non-string id joins nothing', () => {
    expect(resolveJoinHotelRooms({}, 'not-an-id').rooms).toEqual([]);
    expect(resolveJoinHotelRooms({}, { $ne: null }).rooms).toEqual([]);
  });
});

describe('#8 branch-code uniqueness', () => {
  test('two branches of the same org cannot share a branchCode', async () => {
    const hq = await createHotel();
    await createHotel({ parentHotelId: hq._id, branchCode: 'CBE01' });
    await expect(createHotel({ parentHotelId: hq._id, branchCode: 'CBE01' })).rejects.toMatchObject({ code: 11000 });
  });

  test('different orgs may reuse a code; standalone hotels are unaffected', async () => {
    const hq1 = await createHotel();
    const hq2 = await createHotel();
    await createHotel({ parentHotelId: hq1._id, branchCode: 'X1' });
    await expect(createHotel({ parentHotelId: hq2._id, branchCode: 'X1' })).resolves.toBeTruthy();
    await createHotel();
    await createHotel();
    expect(await Hotel.countDocuments({})).toBe(6);
  });
});

describe('#3 INR-only on staff payment creation', () => {
  test('non-INR currency is rejected before any Payment is created', async () => {
    const h = await createHotel({ features: { payment: true } });
    const o = await Order.create({
      hotelId: h._id, orderNumber: 'ORD-1', status: 'served',
      items: [{ productName: 'X', quantity: 1, price: 500, total: 500 }],
      subtotal: 500, taxTotal: 0, grandTotal: 500,
    });
    const res = await request(app).post('/api/payments/create').set(auth(tokenFor(String(h._id))))
      .send({ orderId: String(o._id), amount: 500, currency: 'USD' });
    expect(res.status).toBe(400);
    expect(await Payment.countDocuments({ orderId: o._id })).toBe(0);
  });
});
