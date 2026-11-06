/**
 * Forgotten hotel admin password → Super Admin (no WhatsApp):
 * - login page "Forgot password?" files one high-priority support ticket per day
 *   and never reveals whether a hotel exists;
 * - Super Admin "Reset password" sets a new one-time-shown password, revokes the
 *   hotel's sessions and resolves the request ticket;
 * - the hotel admin can change their own password with the current one.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
jest.mock('expo-server-sdk', () => ({ Expo: class { static isExpoPushToken() { return false; } chunkPushNotifications() { return []; } async sendPushNotificationsAsync() { return []; } } }));
process.env.SUPER_ADMIN_JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || 'test-only-super-admin-secret-0123456789abcdef';

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Hotel from '../../src/models/Hotel';
import Ticket from '../../src/models/Ticket';
import RefreshToken from '../../src/models/RefreshToken';

jest.setTimeout(120_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const authRoutes = require('../../src/routes/authRoutes').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const superAdminRoutes = require('../../src/routes/superAdminRoutes').default;
const app = makeApp([['/api/auth', authRoutes], ['/api/superadmin', superAdminRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const SA = { Authorization: `Bearer ${jwt.sign({ role: 'superadmin' }, process.env.SUPER_ADMIN_JWT_SECRET!)}` };

async function hotelWithLogin(password = 'OldPass123') {
  return createHotel({
    hotelName: 'Malu Hotel', phone: '9876543210', status: 'active',
    adminId: 'DIN123456', adminPasswordHash: await bcrypt.hash(password, 4),
  });
}
const login = (userId: string, password: string) => request(app).post('/api/auth/login').send({ userId, password });

test('Forgot password by Hotel ID or mobile files one Super Admin ticket; unknown IDs get the same answer', async () => {
  const h = await hotelWithLogin();
  const a = await request(app).post('/api/auth/forgot-password').send({ identifier: 'DIN123456' });
  const b = await request(app).post('/api/auth/forgot-password').send({ identifier: '+91 98765 43210' });
  const c = await request(app).post('/api/auth/forgot-password').send({ identifier: 'NOPE000' });
  expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
  expect(a.body.message).toBe(c.body.message);                     // no hint whether the hotel exists
  const tickets = await Ticket.find({ hotelId: h._id }).lean();
  expect(tickets).toHaveLength(1);                                // second request same day doesn't duplicate
  expect(tickets[0]).toMatchObject({ subject: 'Password reset request', priority: 'high', category: 'account', status: 'open' });
  expect(await Ticket.countDocuments()).toBe(1);
});

test('Super Admin reset: new password works, old one does not, sessions revoked, ticket resolved', async () => {
  const h = await hotelWithLogin('OldPass123');
  await request(app).post('/api/auth/forgot-password').send({ identifier: 'DIN123456' });
  expect((await login('DIN123456', 'OldPass123')).status).toBe(200);   // creates a refresh token
  expect(await RefreshToken.countDocuments({ hotelId: h._id, revokedAt: null })).toBe(1);

  const r = await request(app).post(`/api/superadmin/hotels/${h._id}/reset-password`).set(SA);
  expect(r.status).toBe(200);
  expect(r.body.adminId).toBe('DIN123456');
  expect(typeof r.body.password).toBe('string');

  expect((await login('DIN123456', 'OldPass123')).status).toBe(401);
  expect((await login('DIN123456', r.body.password)).status).toBe(200);
  expect(await RefreshToken.countDocuments({ hotelId: h._id, revokedAt: null })).toBe(1);   // only the new login
  const t = await Ticket.findOne({ hotelId: h._id }).lean() as any;
  expect(t.status).toBe('resolved');
  expect(t.replies.at(-1).by).toBe('superadmin');
});

test('reset needs a Super Admin login', async () => {
  const h = await hotelWithLogin();
  expect((await request(app).post(`/api/superadmin/hotels/${h._id}/reset-password`)).status).toBe(401);
  expect((await request(app).post(`/api/superadmin/hotels/${h._id}/reset-password`).set(auth(tokenFor(String(h._id), 'admin')))).status).toBe(401);
});

test('hotel admin changes own password; wrong current / weak new / cashier are refused', async () => {
  const h = await hotelWithLogin('OldPass123');
  const t = tokenFor(String(h._id), 'admin');
  const change = (body: object, token = t) => request(app).post('/api/auth/change-password').set(auth(token)).send(body);

  expect((await change({ currentPassword: 'wrong', newPassword: 'NewPass456' })).status).toBe(400);
  expect((await change({ currentPassword: 'OldPass123', newPassword: 'short1' })).status).toBe(400);
  expect((await change({ currentPassword: 'OldPass123', newPassword: 'NewPass456' }, tokenFor(String(h._id), 'cashier'))).status).toBe(403);
  expect((await change({ currentPassword: 'OldPass123', newPassword: 'NewPass456' })).status).toBe(200);
  expect((await login('DIN123456', 'NewPass456')).status).toBe(200);
  const saved = await Hotel.findById(h._id).select('adminPasswordHash').lean() as any;
  expect(await bcrypt.compare('OldPass123', saved.adminPasswordHash)).toBe(false);
});
