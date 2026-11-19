/**
 * Super Admin lead list / detail carry the website booking-form details
 * (preferred date + time, outlets, what they want to see) as `lead.demo`,
 * read from the original Inquiry — so the Demo Requests page can show the slot.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
// Push SDK is ESM-only and unused here
jest.mock('expo-server-sdk', () => ({ Expo: class { static isExpoPushToken() { return false; } chunkPushNotifications() { return []; } async sendPushNotificationsAsync() { return []; } } }));

process.env.SUPER_ADMIN_JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || 'test-only-super-admin-secret-0123456789abcdef';

import { startDb, stopDb, clearDb, makeApp } from './harness';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Lead from '../../src/models/Lead';
import Inquiry from '../../src/models/Inquiry';

jest.setTimeout(120_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const superAdminRoutes = require('../../src/routes/superAdminRoutes').default;
const app = makeApp([['/api/superadmin', superAdminRoutes]]);
const SA = { Authorization: `Bearer ${jwt.sign({ role: 'superadmin' }, process.env.SUPER_ADMIN_JWT_SECRET!)}` };

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

async function demoLead() {
  const inq = await Inquiry.create({
    type: 'demo', name: 'Ravi', email: 'ravi@example.com', phone: '9876543210', restaurant: 'Annapoorna',
    outlets: '2', preferredDate: '2026-11-10', preferredTime: '11:00 AM', notes: 'Kitchen printing',
  });
  return Lead.create({
    ownerName: 'Ravi', companyName: 'Annapoorna', phone: '9876543210', email: 'ravi@example.com',
    restaurantType: 'Kitchen printing', source: 'website_demo', status: 'new', priority: 'high', inquiryId: inq._id,
  });
}

test('lead list attaches the booking-form slot; manual leads have none', async () => {
  const web = await demoLead();
  await Lead.create({ ownerName: 'Manual', companyName: 'Walk-in', phone: '9000000000', email: 'm@example.com', source: 'manual' });

  const res = await request(app).get('/api/superadmin/leads').set(SA);
  expect(res.status).toBe(200);
  const byId = new Map(res.body.leads.map((l: any) => [String(l._id), l]));
  expect((byId.get(String(web._id)) as any).demo).toEqual({
    preferredDate: '2026-11-10', preferredTime: '11:00 AM', outlets: '2', notes: 'Kitchen printing',
  });
  const manual = res.body.leads.find((l: any) => l.source === 'manual');
  expect(manual.demo).toBeUndefined();
});

test('lead detail attaches the same details; a missing inquiry does not break it', async () => {
  const web = await demoLead();
  const one = await request(app).get(`/api/superadmin/leads/${web._id}`).set(SA);
  expect(one.status).toBe(200);
  expect(one.body.lead.demo.preferredTime).toBe('11:00 AM');

  await Inquiry.deleteMany({});
  const again = await request(app).get(`/api/superadmin/leads/${web._id}`).set(SA);
  expect(again.status).toBe(200);
  expect(again.body.lead.demo).toBeUndefined();
  expect(again.body.lead.companyName).toBe('Annapoorna');
});

test('still Super Admin only', async () => {
  expect((await request(app).get('/api/superadmin/leads')).status).toBe(401);
});
