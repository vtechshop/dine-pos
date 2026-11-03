/**
 * The other AI pages heal a missed nightly summary too: AI Report for a day,
 * the daily snapshot lookup, the AI Dashboard (yesterday at once, older days in
 * the background) and the Morning Brief (yesterday's brief built on open).
 * Real routers + in-memory MongoDB; Gemini is stubbed out (no network).
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
jest.mock('../../src/utils/geminiNarrative', () => ({ generateNarrative: jest.fn(async () => null) }));

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';
import request from 'supertest';
import aiReportRoutes from '../../src/routes/aiReportRoutes';
import aiMetricsRoutes from '../../src/routes/aiMetricsRoutes';
import morningBriefRoutes from '../../src/routes/morningBriefRoutes';
import Order from '../../src/models/Order';
import DailySnapshot from '../../src/models/DailySnapshot';
import MorningBrief from '../../src/models/MorningBrief';
import { startOfBusinessDay, toBusinessDate } from '../../src/utils/businessDate';
import { generateNarrative } from '../../src/utils/geminiNarrative';

const gemini = generateNarrative as jest.Mock;
beforeEach(() => gemini.mockReset().mockResolvedValue(null));

jest.setTimeout(120_000);

const app = makeApp([['/api/ai', aiReportRoutes], ['/api/ai', aiMetricsRoutes], ['/api/ai', morningBriefRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const IST = 'Asia/Kolkata';
const daysAgo = (n: number) => toBusinessDate(new Date(Date.now() - n * 86_400_000), IST);

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

async function hotelWithSalesOn(...dates: string[]) {
  const h = await createHotel({ features: { ai: true } });
  const dosa = await createProduct(h._id, { name: 'Masala Dosa', price: 90 });
  for (const d of dates) {
    await orderOn(h._id, d, 9, dosa, 2);
    await orderOn(h._id, d, 20, dosa, 1);
  }
  return h;
}

const admin = (h: any) => auth(tokenFor(String(h._id), 'admin'));

test('AI Report for a missed day builds the summary and returns the report', async () => {
  const date = daysAgo(2);
  const h = await hotelWithSalesOn(date);
  const r = await request(app).get(`/api/ai/report/${date}`).set(admin(h));
  expect(r.status).toBe(200);
  const snap = await DailySnapshot.findOne({ hotelId: h._id, date }).lean() as any;
  expect(snap.totalOrders).toBe(2);
});

test('the daily summary lookup heals a missed day; a day without sales stays 404', async () => {
  const date = daysAgo(2);
  const h = await hotelWithSalesOn(date);
  const ok = await request(app).get(`/api/ai/metrics/snapshot/${date}`).set(admin(h));
  expect(ok.status).toBe(200);
  expect(ok.body.totalOrders).toBe(2);
  const none = await request(app).get(`/api/ai/metrics/snapshot/${daysAgo(4)}`).set(admin(h));
  expect(none.status).toBe(404);
});

test('AI Dashboard builds yesterday now and fills older missed days in the background', async () => {
  const h = await hotelWithSalesOn(daysAgo(1), daysAgo(3));
  const r = await request(app).get('/api/ai/dashboard').set(admin(h));
  expect(r.status).toBe(200);
  expect(await DailySnapshot.exists({ hotelId: h._id, date: daysAgo(1) })).toBeTruthy();
  // background fill of the older day
  for (let i = 0; i < 60 && !(await DailySnapshot.exists({ hotelId: h._id, date: daysAgo(3) })); i++) {
    await new Promise(res => setTimeout(res, 250));
  }
  expect(await DailySnapshot.exists({ hotelId: h._id, date: daysAgo(3) })).toBeTruthy();
});

test('Morning Brief: a missed yesterday is built when the brief is opened', async () => {
  gemini.mockResolvedValue('SUMMARY: Steady day.\nREC1: a\nREC2: b\nREC3: c\nOPPORTUNITY: d\nWARNING: None');
  const h = await hotelWithSalesOn(daysAgo(1));
  const r = await request(app).get('/api/ai/morning-brief').set(admin(h));
  expect(r.status).toBe(200);
  expect(r.body.date).toBe(daysAgo(1));
  expect(await MorningBrief.countDocuments({ hotelId: h._id, date: daysAgo(1) })).toBe(1);
});

test('Morning Brief: no sales yesterday → nothing is built', async () => {
  const h = await hotelWithSalesOn(daysAgo(3));
  const r = await request(app).get('/api/ai/morning-brief').set(admin(h));
  expect(r.status).toBe(202);
  expect(await MorningBrief.countDocuments({ hotelId: h._id })).toBe(0);
});

test('Morning Brief: if Gemini is down the page answers within ~8 s and the brief lands in the background', async () => {
  const h = await hotelWithSalesOn(daysAgo(1));
  const t0 = Date.now();
  const r = await request(app).get('/api/ai/morning-brief').set(admin(h));
  expect(Date.now() - t0).toBeLessThan(12_000);
  expect([200, 202]).toContain(r.status);
  for (let i = 0; i < 80 && !(await MorningBrief.exists({ hotelId: h._id, date: daysAgo(1) })); i++) {
    await new Promise(res => setTimeout(res, 250));
  }
  expect(await MorningBrief.countDocuments({ hotelId: h._id, date: daysAgo(1) })).toBe(1);
});
