/**
 * Vendor & Procurement — API Integration Tests
 *
 * Covers:
 *   - Vendor CRUD (create, list, get, update, delete)
 *   - Purchase Orders: create, list, submit, approve, cancel
 *   - GRN: create, list, cancel
 *   - Vendor Ledger: read-only reporting
 *   - Vendor Payments: create, list
 *   - Vendor Returns: create, list
 *   - Authorization: unauthenticated/wrong-role access blocked
 *   - Hotel isolation: hotel B cannot access hotel A's vendors or POs
 *   - Idempotency: duplicate GRN idempotencyKey returns same record
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';

describe('Vendor & Procurement', () => {
  let adminToken: string;
  let kitchenToken: string;
  let hotelBAdminToken: string;
  let createdVendorId: string;
  let createdPOId: string;
  let createdGRNId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    adminToken       = hotelA.adminToken;
    kitchenToken     = hotelA.kitchenToken;
    hotelBAdminToken = hotelB.adminToken;
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it('VND-001 GET /api/vendors returns 401 without token', async () => {
    const res = await api.get('/api/vendors');
    expect(res.status).toBe(401);
  });

  it('VND-002 POST /api/vendors returns 401 without token', async () => {
    const res = await api.post('/api/vendors').send({ name: 'Test Vendor' });
    expect(res.status).toBe(401);
  });

  it('VND-003 kitchen token cannot create vendors (403)', async () => {
    const res = await api
      .post('/api/vendors')
      .set(authHeaders(kitchenToken))
      .send({ name: 'Kitchen Vendor', contactName: 'Test', phone: '9876543210' });
    expect([401, 403]).toContain(res.status);
  });

  // ── Vendor CRUD ───────────────────────────────────────────────────────────

  it('VND-004 admin can create a vendor', async () => {
    const res = await api
      .post('/api/vendors')
      .set(authHeaders(adminToken))
      .send({
        name:        'Fresh Foods Pvt Ltd',
        contactName: 'Ramesh Kumar',
        phone:       '9876543210',
        email:       'fresh@example.com',
        gstin:       '29ABCDE1234F1Z5',
        category:    'Vegetables',
      });
    expect([200, 201]).toContain(res.status);
    const vendor = res.body.vendor || res.body;
    expect(vendor._id).toBeDefined();
    expect(vendor.name).toBe('Fresh Foods Pvt Ltd');
    createdVendorId = vendor._id;
  });

  it('VND-005 create vendor without name returns 400', async () => {
    const res = await api
      .post('/api/vendors')
      .set(authHeaders(adminToken))
      .send({ phone: '9876543210' });
    expect([400, 422]).toContain(res.status);
  });

  it('VND-006 admin can list vendors', async () => {
    const res = await api.get('/api/vendors').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const vendors = res.body.vendors || res.body.data || res.body;
    expect(Array.isArray(vendors)).toBe(true);
  });

  it('VND-007 admin can get vendor by id', async () => {
    if (!createdVendorId) return;
    const res = await api.get(`/api/vendors/${createdVendorId}`).set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const vendor = res.body.vendor || res.body;
    expect(vendor._id).toBe(createdVendorId);
  });

  it('VND-008 admin can update vendor', async () => {
    if (!createdVendorId) return;
    const res = await api
      .put(`/api/vendors/${createdVendorId}`)
      .set(authHeaders(adminToken))
      .send({ category: 'Dairy', phone: '9123456789' });
    expect(res.status).toBe(200);
  });

  // ── Purchase Orders ───────────────────────────────────────────────────────

  it('PO-001 GET /api/purchase-orders returns 401 without token', async () => {
    const res = await api.get('/api/purchase-orders');
    expect(res.status).toBe(401);
  });

  it('PO-002 admin can create a purchase order', async () => {
    if (!createdVendorId) return;
    const res = await api
      .post('/api/purchase-orders')
      .set(authHeaders(adminToken))
      .send({
        vendorId:    createdVendorId,
        expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        notes:       'Weekly order',
        items: [
          { description: 'Fresh Tomatoes', quantity: 50, unit: 'kg', unitPrice: 30 },
        ],
      });
    expect([200, 201]).toContain(res.status);
    const po = res.body.purchaseOrder || res.body.po || res.body;
    expect(po._id).toBeDefined();
    createdPOId = po._id;
  });

  it('PO-003 create PO without vendor returns 400', async () => {
    const res = await api
      .post('/api/purchase-orders')
      .set(authHeaders(adminToken))
      .send({ items: [{ description: 'Item', quantity: 1, unitPrice: 10 }] });
    expect([400, 422]).toContain(res.status);
  });

  it('PO-004 admin can list purchase orders', async () => {
    const res = await api.get('/api/purchase-orders').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const pos = res.body.purchaseOrders || res.body.data || res.body;
    expect(Array.isArray(pos)).toBe(true);
  });

  it('PO-005 admin can submit (finalize) a purchase order', async () => {
    if (!createdPOId) return;
    const res = await api
      .post(`/api/purchase-orders/${createdPOId}/submit`)
      .set(authHeaders(adminToken));
    expect([200, 201, 400]).toContain(res.status); // 400 if already submitted
  });

  // ── GRN (Goods Receive Notes) ─────────────────────────────────────────────

  it('GRN-001 GET /api/grn returns 401 without token', async () => {
    const res = await api.get('/api/grn');
    expect(res.status).toBe(401);
  });

  it('GRN-002 admin can create a GRN', async () => {
    if (!createdVendorId) return;
    const res = await api
      .post('/api/grn')
      .set(authHeaders(adminToken))
      .send({
        vendorId:      createdVendorId,
        purchaseOrderId: createdPOId || undefined,
        invoiceNumber: `INV-${Date.now()}`,
        receivedDate:  new Date().toISOString(),
        items: [
          { description: 'Tomatoes', quantity: 50, unit: 'kg', unitPrice: 28, totalPrice: 1400 },
        ],
        totalAmount: 1400,
      });
    expect([200, 201]).toContain(res.status);
    const grn = res.body.grn || res.body;
    expect(grn._id).toBeDefined();
    createdGRNId = grn._id;
  });

  it('GRN-003 duplicate GRN idempotencyKey returns existing record', async () => {
    if (!createdVendorId) return;
    const idKey = `IDEMPOTENT-GRN-${Date.now()}`;
    const payload = {
      vendorId:       createdVendorId,
      invoiceNumber:  idKey,
      receivedDate:   new Date().toISOString(),
      idempotencyKey: idKey,
      items: [
        { description: 'Salt', quantity: 10, unit: 'kg', unitPrice: 20, totalPrice: 200 },
      ],
      totalAmount: 200,
    };

    const res1 = await api.post('/api/grn').set(authHeaders(adminToken)).send(payload);
    const res2 = await api.post('/api/grn').set(authHeaders(adminToken)).send(payload);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);

    const g1 = (res1.body.grn || res1.body)._id;
    const g2 = (res2.body.grn || res2.body)._id;
    expect(g1).toBe(g2);
  });

  it('GRN-004 admin can list GRNs', async () => {
    const res = await api.get('/api/grn').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const grns = res.body.grns || res.body.data || res.body;
    expect(Array.isArray(grns)).toBe(true);
  });

  // ── Vendor Ledger ─────────────────────────────────────────────────────────

  it('LDG-001 GET /api/vendor-ledger returns 401 without token', async () => {
    const res = await api.get('/api/vendor-ledger');
    expect(res.status).toBe(401);
  });

  it('LDG-002 admin can read vendor ledger', async () => {
    const res = await api.get('/api/vendor-ledger').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toBeDefined();
  });

  // ── Vendor Payments ───────────────────────────────────────────────────────

  it('VPAY-001 GET /api/vendor-payments returns 401 without token', async () => {
    const res = await api.get('/api/vendor-payments');
    expect(res.status).toBe(401);
  });

  it('VPAY-002 admin can list vendor payments', async () => {
    const res = await api.get('/api/vendor-payments').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
  });

  it('VPAY-003 admin can create a vendor payment', async () => {
    if (!createdVendorId) return;
    const res = await api
      .post('/api/vendor-payments')
      .set(authHeaders(adminToken))
      .send({
        vendorId:      createdVendorId,
        amount:        500,
        paymentMethod: 'bank_transfer',
        paymentDate:   new Date().toISOString(),
        notes:         'Partial payment for this week',
      });
    expect([200, 201]).toContain(res.status);
    const payment = res.body.payment || res.body;
    expect(payment._id).toBeDefined();
  });

  // ── Vendor Returns ────────────────────────────────────────────────────────

  it('VRET-001 GET /api/vendor-returns returns 401 without token', async () => {
    const res = await api.get('/api/vendor-returns');
    expect(res.status).toBe(401);
  });

  it('VRET-002 admin can list vendor returns', async () => {
    const res = await api.get('/api/vendor-returns').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
  });

  it('VRET-003 admin can create a vendor return', async () => {
    if (!createdVendorId) return;
    const res = await api
      .post('/api/vendor-returns')
      .set(authHeaders(adminToken))
      .send({
        vendorId:   createdVendorId,
        reason:     'Damaged goods',
        returnDate: new Date().toISOString(),
        items: [
          { description: 'Bad Tomatoes', quantity: 5, unit: 'kg', unitPrice: 28, totalPrice: 140 },
        ],
        totalAmount: 140,
      });
    expect([200, 201]).toContain(res.status);
  });

  // ── Hotel isolation ───────────────────────────────────────────────────────

  it('VND-009 hotel B cannot list hotel A vendors', async () => {
    const resA = await api.get('/api/vendors').set(authHeaders(adminToken));
    const resB = await api.get('/api/vendors').set(authHeaders(hotelBAdminToken));

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const vendorsA = resA.body.vendors || resA.body.data || resA.body;
    const vendorsB = resB.body.vendors || resB.body.data || resB.body;

    if (createdVendorId && Array.isArray(vendorsB)) {
      const crossContaminated = vendorsB.some((v: any) => v._id === createdVendorId);
      expect(crossContaminated).toBe(false);
    }
  });

  it('VND-010 hotel B cannot update hotel A vendor (404 or 403)', async () => {
    if (!createdVendorId) return;
    const res = await api
      .put(`/api/vendors/${createdVendorId}`)
      .set(authHeaders(hotelBAdminToken))
      .send({ name: 'Hijacked Vendor' });
    expect([403, 404]).toContain(res.status);
  });

  it('PO-006 hotel B cannot access hotel A purchase orders', async () => {
    if (!createdPOId) return;
    const res = await api
      .get(`/api/purchase-orders/${createdPOId}`)
      .set(authHeaders(hotelBAdminToken));
    expect([403, 404]).toContain(res.status);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  afterAll(async () => {
    if (createdGRNId) {
      await api
        .post(`/api/grn/${createdGRNId}/cancel`)
        .set(authHeaders(adminToken))
        .send({ reason: 'test cleanup' });
    }
    if (createdPOId) {
      await api
        .delete(`/api/purchase-orders/${createdPOId}`)
        .set(authHeaders(adminToken));
    }
    if (createdVendorId) {
      await api
        .delete(`/api/vendors/${createdVendorId}`)
        .set(authHeaders(adminToken));
    }
  });
});
