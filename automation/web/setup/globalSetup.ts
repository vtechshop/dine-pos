import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

const API_URL = process.env.TEST_API_URL || 'http://localhost:5000';
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || 'ci-superadmin';
const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || 'ci-superpass-1234';

const STATE_FILE = path.resolve(__dirname, '../.web-test-state.json');

const client = axios.create({ baseURL: API_URL, validateStatus: () => true });
const saHeaders = { 'x-super-admin-id': SUPER_ADMIN_ID, 'x-super-admin-pass': SUPER_ADMIN_PASS };

let phoneCounter = parseInt('9' + String(Date.now()).slice(-9));
function nextPhone(): string {
  return (++phoneCounter).toString();
}

export default async function globalSetup(): Promise<void> {
  console.log('\n[Web GlobalSetup] Provisioning test hotel...');

  const phone = nextPhone();
  const timestamp = Date.now();

  // Register hotel
  const regRes = await client.post('/api/hotels/register', {
    hotelName: `[WebTest] CI Hotel ${timestamp}`,
    ownerName: 'CI Web Tester',
    phone,
    email: `webtest-${timestamp}@ci.automation.local`,
    businessType: 'restaurant',
    state: 'Maharashtra',
    city: 'Mumbai',
    address: 'CI Test Address',
  });

  if (regRes.status !== 201 && regRes.status !== 200) {
    throw new Error(
      `[Web GlobalSetup] Hotel registration failed: ${regRes.status} ${JSON.stringify(regRes.data)}`,
    );
  }

  const hotelId =
    regRes.data.hotelId || regRes.data.hotel?._id || regRes.data._id || regRes.data.data?._id;
  if (!hotelId) {
    throw new Error(
      `[Web GlobalSetup] No hotelId in registration response: ${JSON.stringify(regRes.data)}`,
    );
  }

  // Approve hotel via super admin
  const approveRes = await client.put(
    `/api/superadmin/hotels/${hotelId}/approve`,
    { plan: 'basic', trialDays: 14 },
    { headers: saHeaders },
  );

  if (approveRes.status !== 200) {
    throw new Error(
      `[Web GlobalSetup] Hotel approval failed: ${approveRes.status} ${JSON.stringify(approveRes.data)}`,
    );
  }

  const creds = approveRes.data.credentials || approveRes.data.hotel || approveRes.data;
  const adminId = creds.adminId || creds.admin?.userId;
  const password = creds.password || creds.admin?.password;

  if (!adminId || !password) {
    throw new Error(
      `[Web GlobalSetup] Missing adminId/password after approval: ${JSON.stringify(approveRes.data)}`,
    );
  }

  // Verify login works
  const loginRes = await client.post('/api/auth/login', { userId: adminId, password });
  if (loginRes.status !== 200) {
    throw new Error(
      `[Web GlobalSetup] Admin login verification failed: ${loginRes.status} ${JSON.stringify(loginRes.data)}`,
    );
  }

  const state = { hotelId, adminId, password, phone, setupAt: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  console.log(`[Web GlobalSetup] Hotel ready: ${hotelId}, adminId: ${adminId}`);
  console.log('[Web GlobalSetup] Setup complete.\n');
}
