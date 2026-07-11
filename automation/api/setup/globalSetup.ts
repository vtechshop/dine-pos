import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import supertest from 'supertest';
import dotenv from 'dotenv';

// Load .env.test before reading any process.env values
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

const API_URL = process.env.TEST_API_URL || 'http://localhost:5000';
const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/dinepos_test';
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '';
const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || '';

const STATE_FILE = path.resolve(__dirname, '../../.test-state.json');
const api = supertest(API_URL);

const superAdminHeaders = {
  'x-super-admin-id': SUPER_ADMIN_ID,
  'x-super-admin-pass': SUPER_ADMIN_PASS,
};

// Timestamp-based start so each run never collides with a previous run's leftover data
let phoneCounter = parseInt('9' + String(Date.now()).slice(-9));
function nextPhone(): string {
  return (++phoneCounter).toString();
}

async function registerAndApproveHotel(label: string): Promise<{
  hotelId: string;
  adminId: string;
  password: string;
  kitchenPin: string;
  phone: string;
}> {
  const phone = nextPhone();

  const regRes = await api.post('/api/hotels/register').send({
    hotelName: `Test ${label} Hotel`,
    ownerName: `Owner ${label}`,
    phone,
    email: `test.${label.toLowerCase()}.${Date.now()}@dinepos-setup.com`,
    businessType: 'restaurant',
    state: 'Maharashtra',
    city: 'Mumbai',
    address: `${label} Test Address`,
  });

  if (regRes.status !== 201 && regRes.status !== 200) {
    throw new Error(`[Setup] registerHotel ${label} failed: ${regRes.status} ${JSON.stringify(regRes.body)}`);
  }

  const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id || regRes.body.data?._id;
  if (!hotelId) {
    throw new Error(`[Setup] No hotelId in registration response for ${label}: ${JSON.stringify(regRes.body)}`);
  }

  const approveRes = await api
    .put(`/api/superadmin/hotels/${hotelId}/approve`)
    .set(superAdminHeaders)
    .send({ plan: 'basic', trialDays: 14 });

  if (approveRes.status !== 200) {
    throw new Error(`[Setup] approveHotel ${label} failed: ${approveRes.status} ${JSON.stringify(approveRes.body)}`);
  }

  const creds = approveRes.body.credentials || approveRes.body.hotel || approveRes.body;
  const adminId = creds.adminId || creds.admin?.userId;
  const password = creds.password || creds.admin?.password;
  const kitchenPin = creds.kitchenPin || creds.kitchen?.pin;

  if (!adminId || !password) {
    throw new Error(`[Setup] Missing adminId/password after approval for ${label}: ${JSON.stringify(approveRes.body)}`);
  }

  return { hotelId, adminId, password, kitchenPin, phone };
}

async function loginAdmin(adminId: string, password: string): Promise<string> {
  const res = await api.post('/api/auth/login').send({ userId: adminId, password });
  if (res.status !== 200) {
    throw new Error(`[Setup] Admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

async function createWaiter(
  token: string,
  label: string
): Promise<{ employeeCode: string; pin: string; waiterId: string }> {
  const pin = '1357';
  const employeeCode = `W${label}001`;
  const res = await api
    .post('/api/waiters')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      name: `Waiter ${label}`,
      employeeCode,
      pin,
      mobile: nextPhone(),
      isActive: true,
    });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`[Setup] createWaiter ${label} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const waiterId = res.body.waiter?._id || res.body._id;
  return { employeeCode, pin, waiterId };
}

async function createCashier(
  token: string,
  label: string
): Promise<{ employeeCode: string; pin: string; cashierId: string }> {
  const pin = '2468';
  const employeeCode = `C${label}001`;
  const res = await api
    .post('/api/cashiers')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      name: `Cashier ${label}`,
      employeeCode,
      pin,
      mobile: nextPhone(),
      isActive: true,
    });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`[Setup] createCashier ${label} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cashierId = res.body.cashier?._id || res.body._id;
  return { employeeCode, pin, cashierId };
}

async function createCategory(token: string, name: string): Promise<string> {
  const res = await api
    .post('/api/categories')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name, color: '#E74C3C', icon: '🍛', isActive: true, sortOrder: 1 });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`[Setup] createCategory "${name}" failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.category?._id || res.body._id;
}

async function createProduct(token: string, categoryId: string, name: string, price: number): Promise<string> {
  const res = await api
    .post('/api/products')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name, price, category: categoryId, isAvailable: true, description: `Test ${name}` });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`[Setup] createProduct "${name}" failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.product?._id || res.body._id;
}

async function loginKitchen(hotelId: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/kitchen').send({ hotelId, pin });
  if (res.status !== 200) {
    throw new Error(`[Setup] Kitchen login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

async function loginWaiter(hotelId: string, employeeCode: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/waiter').send({ hotelId, employeeCode, pin });
  if (res.status !== 200) {
    throw new Error(`[Setup] Waiter login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

async function loginCashier(hotelId: string, employeeCode: string, pin: string): Promise<string> {
  const res = await api.post('/api/auth/cashier').send({ hotelId, employeeCode, pin });
  if (res.status !== 200) {
    throw new Error(`[Setup] Cashier login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token || res.body.accessToken;
}

async function setupHotel(label: string): Promise<Record<string, unknown>> {
  console.log(`[Setup] Bootstrapping Hotel ${label}...`);

  const { hotelId, adminId, password, kitchenPin, phone } = await registerAndApproveHotel(label);
  const adminToken = await loginAdmin(adminId, password);

  const [waiter, cashier] = await Promise.all([
    createWaiter(adminToken, label),
    createCashier(adminToken, label),
  ]);

  const categoryId = await createCategory(adminToken, `Main Course ${label}`);
  const [product1Id, product2Id] = await Promise.all([
    createProduct(adminToken, categoryId, `Paneer Masala ${label}`, 180),
    createProduct(adminToken, categoryId, `Naan ${label}`, 30),
  ]);

  const [kitchenToken, waiterToken, cashierToken] = await Promise.all([
    loginKitchen(hotelId, kitchenPin),
    loginWaiter(hotelId, waiter.employeeCode, waiter.pin),
    loginCashier(hotelId, cashier.employeeCode, cashier.pin),
  ]);

  console.log(`[Setup] Hotel ${label} ready: ${hotelId}`);

  return {
    hotelId,
    adminId,
    password,
    phone,
    kitchenPin,
    adminToken,
    kitchenToken,
    waiterToken,
    cashierToken,
    waiter,
    cashier,
    categoryId,
    products: [
      { id: product1Id, name: `Paneer Masala ${label}`, price: 180 },
      { id: product2Id, name: `Naan ${label}`, price: 30 },
    ],
  };
}

async function cleanupLeftoverTestData(): Promise<void> {
  // Remove hotels from previous failed runs whose phones start with '9'
  // This prevents "phone already registered" errors on re-runs
  const client = new MongoClient(MONGODB_TEST_URI);
  try {
    await client.connect();
    const db = client.db();
    // Clean both 9-prefix (globalSetup phones) and 8-prefix (freshPhone() ad-hoc phones)
    const leftover = await db.collection('hotels')
      .find({ phone: { $regex: '^[89][0-9]{9}$' } })
      .project({ _id: 1 })
      .toArray();

    if (leftover.length === 0) return;

    const relatedCollections = [
      'orders', 'products', 'categories', 'tables', 'settings', 'waiters',
      'cashiers', 'refreshtokens', 'dailycounters', 'notifications',
    ];

    await Promise.all(
      leftover.map(async (h: any) => {
        const hid = h._id.toString();
        await Promise.all([
          db.collection('hotels').deleteOne({ _id: h._id }),
          ...relatedCollections.map(c =>
            db.collection(c).deleteMany({ hotelId: hid }).catch(() => {})
          ),
        ]);
      })
    );
    console.log(`[GlobalSetup] Cleaned up ${leftover.length} leftover test hotel(s) from previous run.`);
  } catch (err) {
    console.warn('[GlobalSetup] Pre-cleanup warning (non-fatal):', err);
  } finally {
    await client.close();
  }
}

export default async function globalSetup(): Promise<void> {
  console.log('\n[GlobalSetup] Starting test environment setup...');

  // Remove leftovers from any previous failed run
  await cleanupLeftoverTestData();

  // Verify API is reachable
  try {
    const health = await api.get('/api/superadmin/health').set(superAdminHeaders);
    if (health.status !== 200) {
      console.warn(`[GlobalSetup] Health check returned ${health.status} — proceeding anyway`);
    }
  } catch (err) {
    throw new Error(`[GlobalSetup] API unreachable at ${API_URL}: ${err}`);
  }

  // Set up two isolated hotels for multi-tenant isolation tests
  const [hotelA, hotelB] = await Promise.all([
    setupHotel('A'),
    setupHotel('B'),
  ]);

  // Also register a pending (unapproved) hotel for status tests
  const pendingPhone = nextPhone();
  const pendingRes = await api.post('/api/hotels/register').send({
    hotelName: 'Test Pending Hotel',
    ownerName: 'Pending Owner',
    phone: pendingPhone,
    email: `test.pending.${Date.now()}@dinepos-setup.com`,
    businessType: 'restaurant',
    state: 'Delhi',
    city: 'New Delhi',
    address: 'Pending Test Address',
  });
  const pendingHotelId = pendingRes.body.hotelId || pendingRes.body.hotel?._id || pendingRes.body._id || pendingRes.body.data?._id;

  const state = {
    hotelA,
    hotelB,
    pendingHotel: {
      hotelId: pendingHotelId,
      phone: pendingPhone,
    },
    setupAt: new Date().toISOString(),
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`[GlobalSetup] State saved to ${STATE_FILE}`);
  console.log('[GlobalSetup] Setup complete.\n');
}
