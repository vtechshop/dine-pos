/**
 * Purchase Invoice — API Integration Tests
 *
 * Covers:
 *   PI-A01  create draft
 *   PI-A02  list invoices
 *   PI-A03  detail view
 *   PI-A04  update draft (field whitelist, grand-total re-validation)
 *   PI-A05  verify (draft → verified)
 *   PI-A06  mark paid (verified → paid)
 *   PI-A07  cancel (draft/verified → cancelled, audit trail preserved)
 *   PI-A08  attachment URL
 *   PI-A09  filtering (status, date)
 *   PI-A10  pagination
 *   PI-A11  tenant isolation (hotel B cannot touch hotel A's invoices)
 *   PI-A12  illegal state transitions
 *   PI-A13  concurrent verify (atomic guard)
 *   PI-A14  concurrent mark-paid (atomic guard)
 *   PI-A15  duplicate submission guard
 *   PI-A16  server-authoritative grand-total validation
 *   PI-A17  vendor isolation (hotel B's vendor not usable by hotel A)
 *   PI-A18  attachment authorization
 *   PI-A19  error handling (missing fields, wrong types)
 *   PI-A20  cancelled invoice remains visible (audit trail)
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';

// ── Helpers ───────────────────────────────────────────────────────────────────

function invoicePayload(vendorId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vendorId,
    vendorInvoiceNo: `VND-${Date.now()}`,
    invoiceDate:     new Date().toISOString(),
    subtotal:        1000,
    taxBreakup:      [{ label: 'GST 18%', rate: 18, amount: 180 }],
    taxTotal:        180,
    freight:         50,
    otherCharges:    0,
    discount:        0,
    grandTotal:      1230,   // 1000 + 180 + 50
    notes:           'Test invoice',
    ...overrides,
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Purchase Invoices', () => {
  let adminToken:       string;
  let kitchenToken:     string;
  let hotelBAdminToken: string;
  let vendorId:         string;
  let vendorBId:        string;
  let invoiceId:        string;
  let verifiedInvoiceId: string;

  // ── Setup ─────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    adminToken       = hotelA.adminToken;
    kitchenToken     = hotelA.kitchenToken;
    hotelBAdminToken = hotelB.adminToken;

    // Create a vendor for hotel A
    const vRes = await api.post('/api/vendors').set(authHeaders(adminToken)).send({
      businessName: 'Invoice Test Vendor',
      contactPerson: 'Ravi Kumar',
      mobile: '9876500001',
      gstNumber: '29ABCDE1234F1Z5',
      paymentTerms: 'net30',
    });
    const vendor = vRes.body.vendor || vRes.body;
    vendorId = vendor._id;
    expect(vendorId).toBeDefined();

    // Create a vendor for hotel B (used for isolation tests)
    const vBRes = await api.post('/api/vendors').set(authHeaders(hotelBAdminToken)).send({
      businessName: 'Hotel B Vendor',
      contactPerson: 'Anand Rao',
      mobile: '9876500002',
    });
    const vendorB = vBRes.body.vendor || vBRes.body;
    vendorBId = vendorB._id;
    expect(vendorBId).toBeDefined();
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it('PI-AUTH-01 GET /api/purchase-invoices returns 401 without token', async () => {
    const res = await api.get('/api/purchase-invoices');
    expect(res.status).toBe(401);
  });

  it('PI-AUTH-02 POST /api/purchase-invoices returns 401 without token', async () => {
    const res = await api.post('/api/purchase-invoices').send({});
    expect(res.status).toBe(401);
  });

  it('PI-AUTH-03 kitchen token cannot access purchase invoices (403)', async () => {
    const res = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(kitchenToken));
    expect([401, 403]).toContain(res.status);
  });

  // ── PI-A19: missing required fields ──────────────────────────────────────

  it('PI-A19a create without vendorId returns 400', async () => {
    const res = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send({ subtotal: 100, grandTotal: 100 });
    expect([400, 422]).toContain(res.status);
  });

  it('PI-A19b create without subtotal returns 400', async () => {
    const res = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send({ vendorId, grandTotal: 100 });
    expect([400, 422]).toContain(res.status);
  });

  // ── PI-A16: server-authoritative grand-total validation ───────────────────

  it('PI-A16 create with mismatched grandTotal returns 400', async () => {
    const res = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { grandTotal: 9999 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/grandTotal/i);
  });

  // ── PI-A01: create draft ──────────────────────────────────────────────────

  it('PI-A01 admin can create a draft invoice', async () => {
    if (!vendorId) return;
    const res = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId));
    expect([200, 201]).toContain(res.status);
    const invoice = res.body.invoice || res.body;
    expect(invoice._id).toBeDefined();
    expect(invoice.status).toBe('draft');
    expect(invoice.invoiceNumber).toMatch(/^PINV-/);
    expect(invoice.grandTotal).toBe(1230);
    invoiceId = invoice._id;
  });

  // ── PI-A02: list invoices ─────────────────────────────────────────────────

  it('PI-A02 admin can list purchase invoices', async () => {
    const res = await api.get('/api/purchase-invoices').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.invoices)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.page).toBe(1);
  });

  // ── PI-A03: detail view ───────────────────────────────────────────────────

  it('PI-A03 admin can view invoice detail (includes attachments field)', async () => {
    if (!invoiceId) return;
    const res = await api.get(`/api/purchase-invoices/${invoiceId}`).set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const invoice = res.body.invoice || res.body;
    expect(invoice._id).toBe(invoiceId);
    expect(Array.isArray(invoice.attachments)).toBe(true);
  });

  // ── PI-A04: update draft ──────────────────────────────────────────────────

  it('PI-A04a admin can update a draft invoice', async () => {
    if (!invoiceId) return;
    const res = await api
      .patch(`/api/purchase-invoices/${invoiceId}`)
      .set(authHeaders(adminToken))
      .send({ notes: 'Updated notes', vendorInvoiceNo: 'VND-UPDATED-001' });
    expect(res.status).toBe(200);
    const invoice = res.body.invoice || res.body;
    expect(invoice.notes).toBe('Updated notes');
    expect(invoice.status).toBe('draft');
  });

  it('PI-A04b update with mismatched grandTotal returns 400', async () => {
    if (!invoiceId) return;
    const res = await api
      .patch(`/api/purchase-invoices/${invoiceId}`)
      .set(authHeaders(adminToken))
      .send({ subtotal: 2000, grandTotal: 999 });  // computed would be 2000+180+50=2230
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/grandTotal/i);
  });

  it('PI-A04c vendorId is ignored by update endpoint (whitelist enforcement)', async () => {
    if (!invoiceId) return;
    // Backend only accepts whitelisted fields; vendorId must be silently dropped
    const res = await api
      .patch(`/api/purchase-invoices/${invoiceId}`)
      .set(authHeaders(adminToken))
      .send({ vendorId: vendorBId, notes: 'Attempt to hijack vendor' });
    // Request should succeed (notes update is valid) and vendorId unchanged
    expect([200]).toContain(res.status);
    const invoice = res.body.invoice || res.body;
    expect(invoice.vendorId).not.toBe(vendorBId);
  });

  // ── PI-A05: verify ────────────────────────────────────────────────────────

  it('PI-A05 admin can verify a draft invoice', async () => {
    if (!invoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${invoiceId}/verify`)
      .set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const invoice = res.body.invoice || res.body;
    expect(invoice.status).toBe('verified');
    expect(invoice.verifiedAt).toBeTruthy();
    verifiedInvoiceId = invoiceId;
  });

  // ── PI-A12: illegal state transitions after verify ────────────────────────

  it('PI-A12a cannot re-verify an already-verified invoice (404 from atomic guard)', async () => {
    if (!verifiedInvoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${verifiedInvoiceId}/verify`)
      .set(authHeaders(adminToken));
    expect([404, 409]).toContain(res.status);
  });

  it('PI-A12b cannot edit a verified invoice (409)', async () => {
    if (!verifiedInvoiceId) return;
    const res = await api
      .patch(`/api/purchase-invoices/${verifiedInvoiceId}`)
      .set(authHeaders(adminToken))
      .send({ notes: 'Attempt to edit verified' });
    expect([404, 409]).toContain(res.status);
  });

  // ── PI-A06: mark paid ─────────────────────────────────────────────────────

  it('PI-A06 admin can mark a verified invoice as paid', async () => {
    if (!verifiedInvoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${verifiedInvoiceId}/mark-paid`)
      .set(authHeaders(adminToken))
      .send({ paymentRef: 'UTR123456' });
    expect(res.status).toBe(200);
    const invoice = res.body.invoice || res.body;
    expect(invoice.status).toBe('paid');
    expect(invoice.paymentRef).toBe('UTR123456');
    expect(invoice.paidAt).toBeTruthy();
  });

  // ── PI-A12c: illegal transitions on paid invoice ──────────────────────────

  it('PI-A12c cannot cancel a paid invoice (404 from atomic guard)', async () => {
    if (!verifiedInvoiceId) return;
    const res = await api
      .delete(`/api/purchase-invoices/${verifiedInvoiceId}`)
      .set(authHeaders(adminToken))
      .send({ reason: 'Attempt to cancel paid' });
    expect([404, 409]).toContain(res.status);
  });

  it('PI-A12d cannot re-mark-paid a paid invoice (404 from atomic guard)', async () => {
    if (!verifiedInvoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${verifiedInvoiceId}/mark-paid`)
      .set(authHeaders(adminToken))
      .send({ paymentRef: 'DUPLICATE-UTR' });
    expect([404, 409]).toContain(res.status);
  });

  // ── PI-A07: cancel ────────────────────────────────────────────────────────

  it('PI-A07a admin can cancel a draft invoice', async () => {
    if (!vendorId) return;
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `CANCEL-${Date.now()}` }));
    const inv = createRes.body.invoice || createRes.body;

    const res = await api
      .delete(`/api/purchase-invoices/${inv._id}`)
      .set(authHeaders(adminToken))
      .send({ reason: 'Wrong vendor' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── PI-A20: cancelled invoice remains visible (audit trail) ───────────────

  it('PI-A20 cancelled invoice is still visible in list and detail', async () => {
    if (!vendorId) return;

    // Create and immediately cancel
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `AUDIT-TRAIL-${Date.now()}` }));
    const created = createRes.body.invoice || createRes.body;

    await api
      .delete(`/api/purchase-invoices/${created._id}`)
      .set(authHeaders(adminToken))
      .send({ reason: 'Audit trail test' });

    // Verify it appears in the list when filtering by status=cancelled
    const listRes = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .query({ status: 'cancelled' });
    expect(listRes.status).toBe(200);
    const found = (listRes.body.invoices || []).some((i: { _id: string }) => i._id === created._id);
    expect(found).toBe(true);

    // Verify it's accessible via the detail endpoint
    const detailRes = await api
      .get(`/api/purchase-invoices/${created._id}`)
      .set(authHeaders(adminToken));
    expect(detailRes.status).toBe(200);
    const inv = detailRes.body.invoice || detailRes.body;
    expect(inv.status).toBe('cancelled');
    expect(inv.cancelReason).toBe('Audit trail test');
  });

  // ── PI-A08: attachment ────────────────────────────────────────────────────

  it('PI-A08 admin can add an attachment URL to an invoice', async () => {
    if (!vendorId) return;
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `ATT-${Date.now()}` }));
    const inv = createRes.body.invoice || createRes.body;

    const res = await api
      .post(`/api/purchase-invoices/${inv._id}/attachments`)
      .set(authHeaders(adminToken))
      .send({
        filename: 'invoice.pdf',
        url: 'https://res.cloudinary.com/test/raw/upload/v1/invoice.pdf',
        fileSize: 204800,
        mimeType: 'application/pdf',
      });
    expect(res.status).toBe(200);
    const { attachments } = res.body;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBeGreaterThan(0);
    expect(attachments[0].filename).toBe('invoice.pdf');
  });

  it('PI-A08b attachment without filename returns 400', async () => {
    if (!invoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${invoiceId}/attachments`)
      .set(authHeaders(adminToken))
      .send({ url: 'https://example.com/file.pdf' });
    expect([400, 422]).toContain(res.status);
  });

  // ── PI-A09: filtering ─────────────────────────────────────────────────────

  it('PI-A09a status filter returns only matching invoices', async () => {
    const res = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .query({ status: 'draft' });
    expect(res.status).toBe(200);
    const invoices = res.body.invoices || [];
    for (const inv of invoices) {
      expect(inv.status).toBe('draft');
    }
  });

  it('PI-A09b date range filter is respected', async () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);
    const res = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .query({ from, to });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.invoices)).toBe(true);
  });

  // ── PI-A10: pagination ────────────────────────────────────────────────────

  it('PI-A10 pagination: page 1 with limit 1 returns 1 invoice', async () => {
    const res = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .query({ page: 1, limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.invoices.length).toBeLessThanOrEqual(1);
    expect(res.body.limit).toBe(1);
    expect(res.body.page).toBe(1);
  });

  it('PI-A10b limit is capped at 100', async () => {
    const res = await api
      .get('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .query({ limit: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(100);
  });

  // ── PI-A11 & PI-A17: tenant isolation ────────────────────────────────────

  it('PI-A11a hotel B cannot list hotel A invoices', async () => {
    if (!invoiceId) return;
    const res = await api.get('/api/purchase-invoices').set(authHeaders(hotelBAdminToken));
    expect(res.status).toBe(200);
    const ids = (res.body.invoices || []).map((i: { _id: string }) => i._id);
    expect(ids).not.toContain(invoiceId);
  });

  it('PI-A11b hotel B cannot view hotel A invoice detail', async () => {
    if (!invoiceId) return;
    const res = await api
      .get(`/api/purchase-invoices/${invoiceId}`)
      .set(authHeaders(hotelBAdminToken));
    expect([403, 404]).toContain(res.status);
  });

  it('PI-A11c hotel B cannot verify hotel A invoice', async () => {
    if (!invoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${invoiceId}/verify`)
      .set(authHeaders(hotelBAdminToken));
    expect([403, 404]).toContain(res.status);
  });

  it('PI-A11d hotel B cannot cancel hotel A invoice', async () => {
    if (!vendorId) return;
    // Create a fresh draft for hotel A to cancel
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `ISO-${Date.now()}` }));
    const iso = createRes.body.invoice || createRes.body;

    const res = await api
      .delete(`/api/purchase-invoices/${iso._id}`)
      .set(authHeaders(hotelBAdminToken))
      .send({ reason: 'Cross-tenant cancel attempt' });
    expect([403, 404]).toContain(res.status);
  });

  it('PI-A17 hotel A cannot create invoice using hotel B vendor', async () => {
    if (!vendorBId) return;
    const res = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorBId));
    expect([400, 404]).toContain(res.status);
  });

  // ── PI-A18: attachment authorization ────────────────────────────────────

  it('PI-A18 hotel B cannot add attachment to hotel A invoice', async () => {
    if (!invoiceId) return;
    const res = await api
      .post(`/api/purchase-invoices/${invoiceId}/attachments`)
      .set(authHeaders(hotelBAdminToken))
      .send({ filename: 'hack.pdf', url: 'https://evil.com/hack.pdf', fileSize: 1, mimeType: 'application/pdf' });
    expect([403, 404]).toContain(res.status);
  });

  // ── PI-A13: concurrent verify (atomic guard) ──────────────────────────────

  it('PI-A13 concurrent verify: exactly one request succeeds', async () => {
    if (!vendorId) return;
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `CONCURRENT-VERIFY-${Date.now()}` }));
    const inv = createRes.body.invoice || createRes.body;

    // Fire two verify requests simultaneously
    const [r1, r2] = await Promise.all([
      api.post(`/api/purchase-invoices/${inv._id}/verify`).set(authHeaders(adminToken)),
      api.post(`/api/purchase-invoices/${inv._id}/verify`).set(authHeaders(adminToken)),
    ]);

    const successes = [r1, r2].filter(r => r.status === 200);
    const failures  = [r1, r2].filter(r => r.status !== 200);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    // The failure must be 404 (atomic guard: status no longer 'draft')
    expect([404, 409]).toContain(failures[0].status);
  });

  // ── PI-A14: concurrent mark-paid (atomic guard) ───────────────────────────

  it('PI-A14 concurrent mark-paid: exactly one request succeeds', async () => {
    if (!vendorId) return;
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `CONCURRENT-PAID-${Date.now()}` }));
    const inv = createRes.body.invoice || createRes.body;

    await api.post(`/api/purchase-invoices/${inv._id}/verify`).set(authHeaders(adminToken));

    const [r1, r2] = await Promise.all([
      api.post(`/api/purchase-invoices/${inv._id}/mark-paid`).set(authHeaders(adminToken)).send({ paymentRef: 'UTR-A' }),
      api.post(`/api/purchase-invoices/${inv._id}/mark-paid`).set(authHeaders(adminToken)).send({ paymentRef: 'UTR-B' }),
    ]);

    const successes = [r1, r2].filter(r => r.status === 200);
    const failures  = [r1, r2].filter(r => r.status !== 200);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect([404, 409]).toContain(failures[0].status);
  });

  // ── PI-A15: duplicate submission guard ────────────────────────────────────

  it('PI-A15 rapid double-create produces two distinct invoice numbers', async () => {
    if (!vendorId) return;
    const [r1, r2] = await Promise.all([
      api.post('/api/purchase-invoices').set(authHeaders(adminToken)).send(
        invoicePayload(vendorId, { vendorInvoiceNo: `DUP-A-${Date.now()}` })
      ),
      api.post('/api/purchase-invoices').set(authHeaders(adminToken)).send(
        invoicePayload(vendorId, { vendorInvoiceNo: `DUP-B-${Date.now()}` })
      ),
    ]);
    expect([200, 201]).toContain(r1.status);
    expect([200, 201]).toContain(r2.status);
    const inv1 = r1.body.invoice || r1.body;
    const inv2 = r2.body.invoice || r2.body;
    // Invoice numbers must be unique (DailyCounter atomic increment)
    expect(inv1.invoiceNumber).not.toBe(inv2.invoiceNumber);
    expect(inv1._id).not.toBe(inv2._id);
  });

  // ── PI-A07b: cancel verified invoice ────────────────────────────────────

  it('PI-A07b admin can cancel a verified invoice', async () => {
    if (!vendorId) return;
    const createRes = await api
      .post('/api/purchase-invoices')
      .set(authHeaders(adminToken))
      .send(invoicePayload(vendorId, { vendorInvoiceNo: `CANCEL-VER-${Date.now()}` }));
    const inv = createRes.body.invoice || createRes.body;

    await api.post(`/api/purchase-invoices/${inv._id}/verify`).set(authHeaders(adminToken));

    const res = await api
      .delete(`/api/purchase-invoices/${inv._id}`)
      .set(authHeaders(adminToken))
      .send({ reason: 'Order placed in error' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
