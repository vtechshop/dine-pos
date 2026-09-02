/**
 * Kiosk Ordering — API Integration Tests
 *
 * Covers:
 *   - Kiosk orders created via POST /api/public/orders with orderSource=kiosk
 *   - orderSource is preserved in database
 *   - Kitchen receives kiosk orders
 *   - Hotel isolation: kiosk order sent to wrong hotelId is rejected
 *   - Feature flag: kiosk ordering is tracked separately from QR/dine-in
 *   - Duplicate protection via offlineId
 *   - Validation: missing required fields
 *
 * Note: features.kiosk is a premium flag. Tests use POST /api/public/orders
 * which is the endpoint the mobile Customer tab actually calls.
 * The new POST /api/public/qr/orders endpoint (tableSessions flow) has its
 * own kiosk guard tested separately.
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';
import { createCategory, createProduct } from '../../helpers/menu.helper';
import { v4 as uuidv4 } from 'uuid';

describe('Kiosk Ordering', () => {
  let hotelId: string;
  let adminToken: string;
  let kitchenToken: string;
  let hotelBId: string;
  let testProductId: string;

  beforeAll(async () => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    hotelId      = hotelA.hotelId;
    adminToken   = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    hotelBId     = hotelB.hotelId;

    // Create a product to use in kiosk orders (server re-prices from catalog)
    const cat  = await createCategory(adminToken);
    const prod = await createProduct(adminToken, cat.id);
    testProductId = prod.id;
  });

  function kioskOrderBody(overrides: Record<string, any> = {}) {
    return {
      hotelId,
      tableNumber:   'K1',
      customerName:  'Kiosk Customer',
      customerPhone: '9000000001',
      orderSource:   'kiosk',
      items: [
        {
          product:     testProductId,
          productName: 'Kiosk Item',
          quantity:    1,
          price:       100,
          total:       100,
        },
      ],
      subtotal:      100,
      taxTotal:      9,
      grandTotal:    109,
      paymentMethod: 'cash',
      notes:         '',
      ...overrides,
    };
  }

  // ── Basic kiosk order creation ────────────────────────────────────────────

  it('KSK-001 kiosk order is created without auth (public endpoint)', async () => {
    const res = await api.post('/api/public/orders').send(kioskOrderBody());
    expect([200, 201]).toContain(res.status);
    const order = res.body.order || res.body;
    expect(order._id).toBeDefined();
  });

  it('KSK-002 orderSource is preserved as kiosk in the database', async () => {
    const res = await api.post('/api/public/orders').send(kioskOrderBody());
    expect([200, 201]).toContain(res.status);
    const order = res.body.order || res.body;
    expect(order.orderSource).toBe('kiosk');
  });

  it('KSK-003 kiosk order appears in kitchen orders', async () => {
    const res = await api.post('/api/public/orders').send(kioskOrderBody());
    const orderId = (res.body.order || res.body)._id;

    const kitchenRes = await api.get('/api/orders/kitchen').set(authHeaders(kitchenToken));
    const orders = kitchenRes.body.orders || kitchenRes.body.data || kitchenRes.body;
    const found = Array.isArray(orders) && orders.some((o: any) => o._id === orderId);
    expect(found).toBe(true);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('KSK-004 kiosk order without hotelId returns 400', async () => {
    const body = kioskOrderBody();
    delete (body as any).hotelId;
    const res = await api.post('/api/public/orders').send(body);
    expect([400, 422]).toContain(res.status);
  });

  it('KSK-005 kiosk order with invalid hotelId returns 400 or 404', async () => {
    const res = await api.post('/api/public/orders').send(
      kioskOrderBody({ hotelId: '000000000000000000000000' })
    );
    expect([400, 404]).toContain(res.status);
  });

  it('KSK-006 kiosk order without items returns 400', async () => {
    const res = await api.post('/api/public/orders').send(kioskOrderBody({ items: [] }));
    expect([400, 422]).toContain(res.status);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  it('KSK-007 kiosk order sent to hotel B hotelId cannot access hotel A products', async () => {
    // The server re-prices items from its own catalog.
    // An order sent to hotel B with a hotel A productId should result in
    // no valid items (404) or an empty order rejection (400).
    const res = await api.post('/api/public/orders').send(
      kioskOrderBody({ hotelId: hotelBId })
      // testProductId belongs to hotel A — hotel B catalog lookup returns nothing
    );
    // Either the hotel is not found or no valid items are found
    expect([400, 404]).toContain(res.status);
  });

  // ── Duplicate protection ───────────────────────────────────────────────────

  it('KSK-008 duplicate offlineId for kiosk order returns same order', async () => {
    const offlineId = uuidv4();
    const body      = kioskOrderBody({ offlineId });
    const res1 = await api.post('/api/public/orders').send(body);
    const res2 = await api.post('/api/public/orders').send(body);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);

    const id1 = (res1.body.order || res1.body)._id;
    const id2 = (res2.body.order || res2.body)._id;
    expect(id1).toBe(id2);
  });

  it('KSK-009 duplicate offlineId does not create a second kitchen order', async () => {
    const offlineId = uuidv4();
    const body      = kioskOrderBody({ offlineId });
    await api.post('/api/public/orders').send(body);
    await api.post('/api/public/orders').send(body);

    // The kitchen should have exactly one order for this offlineId
    const kitchenRes = await api.get('/api/orders/kitchen').set(authHeaders(kitchenToken));
    const orders = kitchenRes.body.orders || kitchenRes.body.data || kitchenRes.body;
    if (Array.isArray(orders)) {
      const matching = orders.filter((o: any) => o.offlineId === offlineId);
      expect(matching.length).toBeLessThanOrEqual(1);
    }
  });

  // ── Server-side pricing ────────────────────────────────────────────────────

  it('KSK-010 server ignores client-supplied price and uses catalog price', async () => {
    // Send a wildly inflated client price — server must ignore it
    const body = kioskOrderBody({
      items: [{
        product:     testProductId,
        productName: 'Kiosk Item',
        quantity:    1,
        price:       9999,  // client tries to inflate price
        total:       9999,
      }],
      grandTotal: 9999,
    });
    const res = await api.post('/api/public/orders').send(body);
    expect([200, 201]).toContain(res.status);
    const order = res.body.order || res.body;
    // Server should have corrected the price to catalog value (not 9999)
    const item = order.items?.[0];
    if (item) {
      expect(item.price).not.toBe(9999);
    }
  });

  // ── QR Session flow kiosk gate ────────────────────────────────────────────

  it('KSK-011 POST /api/public/qr/orders with orderSource=kiosk and no tableSessions feature returns 403 or 400', async () => {
    // The new qrRoutes endpoint requires features.tableSessions.
    // Most test hotels won't have this, so we expect a feature-disabled error.
    const res = await api.post('/api/public/qr/orders').send({
      hotelId,
      orderSource: 'kiosk',
      items: [{
        product:  testProductId,
        quantity: 1,
      }],
    });
    // Should be rejected — either no tableSessions feature or no valid table
    expect([400, 403, 404]).toContain(res.status);
  });
});
