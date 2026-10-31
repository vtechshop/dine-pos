/**
 * AI Recommendations catch-up: the nightly DailySnapshot runs in one minute per
 * hotel; if that minute is missed the day has no summary and the page said
 * "No data available". A missing *closed* day is now built on demand from that
 * day's orders. Today is never built (a part-day summary would skew trends).
 * Real router + in-memory MongoDB.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';
import request from 'supertest';
import aiAlertsRoutes from '../../src/routes/aiAlertsRoutes';
import Order from '../../src/models/Order';
import DailySnapshot from '../../src/models/DailySnapshot';
import { todayBusinessDate, startOfBusinessDay, toBusinessDate } from '../../src/utils/businessDate';

jest.setTimeout(120_000);

const app = makeApp([['/api/ai', aiAlertsRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const IST = 'Asia/Kolkata';
const daysAgo = (n: number) => toBusinessDate(new Date(Date.now() - n * 86_400_000), IST);

/** A completed order placed at `hoursIntoDay` local time on business date `date`. */
async function orderOn(hotelId: unknown, date: string, hoursIntoDay: number, product: any, qty: number) {
  const o = await Order.create({
    hotelId, orderNumber: `ORD-${Math.random()}`, status: 'completed', orderSource: 'dine-in',
    paymentMethod: 'cash', completedAt: new Date(),
    items: [{ product: product._id, productName: product.name, quantity: qty, price: product.price, total: product.price * qty }],
    subtotal: product.price * qty, taxTotal: 0, grandTotal: product.price * qty,
    customerName: 'Ravi', customerPhone: '9876543210',
  });
  const at = new Date(startOfBusinessDay(date, IST).getTime() + hoursIntoDay * 3600_000);
  await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: at, completedAt: at } });
}

async function hotelWithSales(date: string) {
  const h = await createHotel({ features: { ai: true } });
  const dosa = await createProduct(h._id, { name: 'Masala Dosa', price: 90 });
  const tea  = await createProduct(h._id, { name: 'Black Tea', price: 20 });
  await orderOn(h._id, date, 9, dosa, 2);
  await orderOn(h._id, date, 13, tea, 3);
  await orderOn(h._id, date, 20, dosa, 1);
  return h;
}

test('a past day with sales but no nightly summary now returns recommendations', async () => {
  const date = daysAgo(2);
  const h = await hotelWithSales(date);
  expect(await DailySnapshot.countDocuments({ hotelId: h._id })).toBe(0);

  const r = await request(app).get(`/api/ai/recommendations/${date}`).set(auth(tokenFor(String(h._id), 'admin')));
  expect(r.status).toBe(200);

  const snap = await DailySnapshot.findOne({ hotelId: h._id, date }).lean() as any;
  expect(snap).toBeTruthy();
  expect(snap.totalOrders).toBe(3);
  expect(snap.totalRevenue).toBeCloseTo(90 * 2 + 20 * 3 + 90, 2);
  expect(snap.allItems.map((i: any) => i.productName).sort()).toEqual(['Black Tea', 'Masala Dosa']);
});

test('a day with no sales still says no data, and builds nothing', async () => {
  const h = await hotelWithSales(daysAgo(2));
  const empty = daysAgo(3);
  const r = await request(app).get(`/api/ai/recommendations/${empty}`).set(auth(tokenFor(String(h._id), 'admin')));
  expect(r.status).toBe(404);
  expect(await DailySnapshot.countDocuments({ hotelId: h._id, date: empty })).toBe(0);
});

test('today is never summarised early (part-day data would skew trends)', async () => {
  const today = todayBusinessDate(IST);
  const h = await hotelWithSales(today);
  await request(app).get(`/api/ai/recommendations/${today}`).set(auth(tokenFor(String(h._id), 'admin')));
  expect(await DailySnapshot.countDocuments({ hotelId: h._id, date: today })).toBe(0);
});

test('the default view builds a missed yesterday and shows it', async () => {
  const yesterday = daysAgo(1);
  const h = await hotelWithSales(yesterday);
  const r = await request(app).get('/api/ai/recommendations').set(auth(tokenFor(String(h._id), 'admin')));
  expect(r.status).toBe(200);
  expect(r.body.date).toBe(yesterday);
});

test('another hotel’s orders never leak into the summary', async () => {
  const date = daysAgo(2);
  const mine  = await hotelWithSales(date);
  await hotelWithSales(date); // second hotel, same day
  await request(app).get(`/api/ai/recommendations/${date}`).set(auth(tokenFor(String(mine._id), 'admin')));
  const snap = await DailySnapshot.findOne({ hotelId: mine._id, date }).lean() as any;
  expect(snap.totalOrders).toBe(3);
});
