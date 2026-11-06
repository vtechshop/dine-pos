/**
 * PATCH /api/products/:id/availability — mark a dish in / out of stock from the POS.
 * Real router + in-memory MongoDB. Cashier, kitchen and admin may; waiters may not.
 * Only isAvailable changes; a stock-tracked dish with 0 left can't be switched back on.
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';
import request from 'supertest';
import productRoutes from '../../src/routes/productRoutes';
import Product from '../../src/models/Product';
import Cashier from '../../src/models/Cashier';
import Settings from '../../src/models/Settings';

jest.setTimeout(90_000);

const app = makeApp([['/api/products', productRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const patch = (token: string, id: unknown, body: unknown) =>
  request(app).patch(`/api/products/${id}/availability`).set(auth(token)).send(body as object);

test('admin marks a dish out of stock and back; nothing else changes', async () => {
  const h = await createHotel();
  const p = await createProduct(h._id, { price: 180, name: 'Veg Biryani' });
  const t = tokenFor(String(h._id), 'admin');

  const off = await patch(t, p._id, { isAvailable: false });
  expect(off.status).toBe(200);
  expect(off.body.isAvailable).toBe(false);
  let saved = await Product.findById(p._id).lean() as any;
  expect(saved.isAvailable).toBe(false);
  expect(saved.price).toBe(180);
  expect(saved.name).toBe('Veg Biryani');

  const on = await patch(t, p._id, { isAvailable: true });
  expect(on.status).toBe(200);
  saved = await Product.findById(p._id).lean() as any;
  expect(saved.isAvailable).toBe(true);
});

test('a signed-in cashier can toggle stock; a deactivated one cannot', async () => {
  const h = await createHotel();
  const p = await createProduct(h._id);
  const c = await Cashier.create({ hotelId: h._id, name: 'Ravi', employeeCode: 'C01', pin: 'x', mobile: '9876543210', isActive: true });
  const t = tokenFor(String(h._id), 'cashier', { cashierId: String(c._id), cashierName: 'Ravi' });
  expect((await patch(t, p._id, { isAvailable: false })).status).toBe(200);
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(false);

  await Cashier.updateOne({ _id: c._id }, { $set: { isActive: false } });
  expect((await patch(t, p._id, { isAvailable: true })).status).toBe(401);
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(false);
});

test('kitchen staff can toggle stock (while the kitchen PIN is set)', async () => {
  const h = await createHotel();
  await Settings.create({ hotelId: h._id, kitchenPin: 'hashed-pin' });
  const p = await createProduct(h._id);
  const r = await patch(tokenFor(String(h._id), 'kitchen'), p._id, { isAvailable: false });
  expect(r.status).toBe(200);
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(false);
});

test('waiters cannot change stock', async () => {
  const h = await createHotel();
  const p = await createProduct(h._id);
  const r = await patch(tokenFor(String(h._id), 'waiter'), p._id, { isAvailable: false });
  expect([401, 403]).toContain(r.status);
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(true);
});

test('a stock-tracked dish with 0 left cannot be switched back on, but can be switched off', async () => {
  const h = await createHotel();
  const p = await createProduct(h._id, { stock: 0, isAvailable: false });
  const t = tokenFor(String(h._id), 'admin');
  const on = await patch(t, p._id, { isAvailable: true });
  expect(on.status).toBe(409);
  expect(on.body.code).toBe('NO_STOCK');
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(false);

  const q = await createProduct(h._id, { stock: 0, isAvailable: true });
  expect((await patch(t, q._id, { isAvailable: false })).status).toBe(200);
});

test('another hotel cannot touch the dish; bad input is refused', async () => {
  const h = await createHotel();
  const other = await createHotel();
  const p = await createProduct(h._id);
  expect((await patch(tokenFor(String(other._id), 'admin'), p._id, { isAvailable: false })).status).toBe(404);
  expect((await Product.findById(p._id).lean() as any).isAvailable).toBe(true);

  const t = tokenFor(String(h._id), 'admin');
  expect((await patch(t, p._id, { isAvailable: 'no' })).status).toBe(400);
  expect((await patch(t, 'not-an-id', { isAvailable: false })).status).toBe(400);
});
