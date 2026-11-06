/**
 * Alerts → History. Alerts used to be saved only when someone opened the Alerts
 * page AND the hotel already had 3+ days of nightly summaries, so new hotels or
 * hotels with missed nights saw "No History". Now a finished day's alerts are
 * recorded when its summary is built (nightly or catch-up), and alerts found
 * with little history are saved too. Real router + in-memory MongoDB.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
jest.mock('../../src/utils/geminiNarrative', () => ({ generateNarrative: jest.fn(async () => null) }));

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';
import request from 'supertest';
import aiAlertsRoutes from '../../src/routes/aiAlertsRoutes';
import Order from '../../src/models/Order';
import Alert from '../../src/models/Alert';
import { startOfBusinessDay, toBusinessDate } from '../../src/utils/businessDate';
import { ensureDailySnapshot } from '../../src/utils/ensureDailySnapshot';

jest.setTimeout(120_000);

const app = makeApp([['/api/ai', aiAlertsRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const IST = 'Asia/Kolkata';
const daysAgo = (n: number) => toBusinessDate(new Date(Date.now() - n * 86_400_000), IST);

async function orderOn(hotelId: unknown, date: string, hour: number, product: any, status: string) {
  const o = await Order.create({
    hotelId, orderNumber: `ORD-${Math.random()}`, status, orderSource: 'dine-in', paymentMethod: 'cash',
    items: [{ product: product._id, productName: product.name, quantity: 1, price: product.price, total: product.price }],
    subtotal: product.price, taxTotal: 0, grandTotal: product.price,
    customerName: 'Ravi', customerPhone: '9876543210',
  });
  const at = new Date(startOfBusinessDay(date, IST).getTime() + hour * 3600_000);
  await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: at } });
}

/** A day where half the orders were cancelled — a cancellation alert must fire. */
async function badDay(date: string) {
  const h = await createHotel({ features: { ai: true } });
  const dosa = await createProduct(h._id, { name: 'Masala Dosa', price: 90 });
  for (let i = 0; i < 3; i++) await orderOn(h._id, date, 10 + i, dosa, 'completed');
  for (let i = 0; i < 3; i++) await orderOn(h._id, date, 14 + i, dosa, 'cancelled');
  return h;
}

const admin = (h: any) => auth(tokenFor(String(h._id), 'admin'));

test('building a missed day records its alerts — History shows them without opening Alerts', async () => {
  const date = daysAgo(2);
  const h = await badDay(date);
  expect(await ensureDailySnapshot(String(h._id), date)).toBe(true);

  const r = await request(app).get('/api/ai/alerts/history').set(admin(h));
  expect(r.status).toBe(200);
  const hit = r.body.alerts.find((a: any) => a.type === 'excessive_cancellations');
  expect(hit).toBeTruthy();
  expect(hit.dedupDate).toBe(date);
});

test('alerts found with little history (new hotel) are saved, not just shown', async () => {
  const date = daysAgo(2);
  const h = await badDay(date);
  await ensureDailySnapshot(String(h._id), date);
  await Alert.deleteMany({ hotelId: h._id }); // pretend nothing was recorded yet

  const shown = await request(app).get(`/api/ai/alerts/${date}`).set(admin(h));
  expect(shown.status).toBe(200);
  expect(shown.body.alerts.map((a: any) => a.type)).toContain('excessive_cancellations');
  expect(await Alert.countDocuments({ hotelId: h._id, dedupDate: date, type: 'excessive_cancellations' })).toBe(1);
});

test('a calm day records nothing; another hotel’s alerts never show', async () => {
  const date = daysAgo(2);
  const bad  = await badDay(date);
  await ensureDailySnapshot(String(bad._id), date);

  const calm = await createHotel({ features: { ai: true } });
  const tea  = await createProduct(calm._id, { name: 'Black Tea', price: 20 });
  for (let i = 0; i < 6; i++) await orderOn(calm._id, date, 9 + i, tea, 'completed');
  await ensureDailySnapshot(String(calm._id), date);

  const r = await request(app).get('/api/ai/alerts/history').set(admin(calm));
  expect(r.status).toBe(200);
  expect(r.body.alerts).toEqual([]);
});
