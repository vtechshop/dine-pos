import { api } from '../../utils/api-client';
import { superAdminHeaders } from '../../utils/env';
import { freshPhone, freshEmail } from '../setup/testEnv';
import { hotelRegistrationPayload } from '../../utils/test-data';

export interface RegisterResult {
  hotelId: string;
  phone: string;
}

export interface ApproveResult {
  adminId: string;
  password: string;
  kitchenPin: string;
}

export interface FullAuthContext {
  hotelId: string;
  phone: string;
  adminId: string;
  password: string;
  kitchenPin: string;
  adminToken: string;
  kitchenToken: string;
  refreshToken: string;
}

export async function registerHotelRaw(
  overrides: Record<string, unknown> = {}
): Promise<{ body: any; status: number }> {
  const res = await api.post('/api/hotels/register').send(
    hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail('reg'), ...overrides })
  );
  return { body: res.body, status: res.status };
}

export async function registerHotel(overrides: Record<string, unknown> = {}): Promise<RegisterResult> {
  const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail('reg'), ...overrides });
  const res = await api.post('/api/hotels/register').send(payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`registerHotel failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const hotelId = res.body.hotelId || res.body.hotel?._id || res.body._id || res.body.data?._id;
  if (!hotelId) throw new Error(`No hotelId in: ${JSON.stringify(res.body)}`);
  return { hotelId, phone: payload.phone as string };
}

export async function approveHotel(hotelId: string): Promise<ApproveResult> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/approve`)
    .set(superAdminHeaders)
    .send({ plan: 'basic', trialDays: 14 });
  if (res.status !== 200) {
    throw new Error(`approveHotel failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const creds = res.body.credentials || res.body.hotel || res.body;
  return {
    adminId: creds.adminId || creds.admin?.userId,
    password: creds.password || creds.admin?.password,
    kitchenPin: creds.kitchenPin || creds.kitchen?.pin,
  };
}

export async function adminLogin(adminId: string, password: string): Promise<{ token: string; refreshToken: string }> {
  const res = await api.post('/api/auth/login').send({ userId: adminId, password });
  if (res.status !== 200) {
    throw new Error(`adminLogin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.token || res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export async function kitchenLogin(hotelId: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/kitchen').send({ hotelId, pin });
  if (res.status !== 200) {
    throw new Error(`kitchenLogin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

export async function waiterLogin(hotelId: string, employeeCode: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/waiter').send({ hotelId, employeeCode, pin });
  if (res.status !== 200) {
    throw new Error(`waiterLogin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

export async function cashierLogin(hotelId: string, employeeCode: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/cashier').send({ hotelId, employeeCode, pin });
  if (res.status !== 200) {
    throw new Error(`cashierLogin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

export async function createFullAuthContext(): Promise<FullAuthContext> {
  const { hotelId, phone } = await registerHotel();
  const { adminId, password, kitchenPin } = await approveHotel(hotelId);
  const { token: adminToken, refreshToken } = await adminLogin(adminId, password);
  const kitchenToken = await kitchenLogin(hotelId, kitchenPin);
  return { hotelId, phone, adminId, password, kitchenPin, adminToken, kitchenToken, refreshToken };
}
