/**
 * Barcode Scanning — Integration Tests (BAR)
 *
 * Verifies hotel-scoped barcode lookup, normalization, tenant isolation,
 * inactive/deleted product gating, duplicate enforcement, and edge cases.
 *
 * BAR-A: Valid barcode → found: true, correct product returned
 * BAR-B: Lowercase input → normalized to uppercase, found
 * BAR-C: Input with leading/trailing spaces → trimmed and found
 * BAR-D: Unknown barcode → 404, found: false
 * BAR-E: Inactive product barcode → 404, found: false, inactive: true
 * BAR-F: Hotel A barcode not returned to Hotel B (tenant isolation)
 * BAR-G: Same barcode in different hotels → both resolve correctly
 * BAR-H: Soft-deleted product barcode → 404, found: false
 * BAR-I: Empty barcode field → not matched by barcode lookup
 * BAR-J: Create product without barcode → set barcode via PUT → lookup works
 * BAR-K: Server returns price from DB, not from client (price trust)
 * BAR-L: Duplicate barcode within same hotel → rejected (409 or 400)
 * BAR-M: Unauthenticated barcode lookup → 401
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';
import { productPayload } from '../../../utils/test-data';
import crypto from 'crypto';

// Unique suffix per test run to avoid cross-run collisions
function uniqueBarcode(prefix = 'BAR'): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 10)}`;
}

describe('Barcode Scanning — Lookup & Isolation (BAR)', () => {
  let adminTokenA: string;
  let adminTokenB: string;
  let categoryIdA: string;
  let categoryIdB: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    adminTokenA = hotelA.adminToken;
    adminTokenB = hotelB.adminToken;
    categoryIdA = hotelA.categoryId;
    categoryIdB = hotelB.categoryId;
  });

  // ── Helper: create a product with a specific barcode ────────────────────────
  async function createProductWithBarcode(
    token: string,
    categoryId: string,
    barcode: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; price: number }> {
    const payload = {
      ...productPayload(categoryId),
      barcode,
      price: 150,
      ...overrides,
    };
    const res = await api.post('/api/products').set(authHeaders(token)).send(payload);
    expect(res.status).toBe(201);
    const prod = res.body.product ?? res.body;
    return { id: prod._id, price: prod.price };
  }

  // ── BAR-A ──────────────────────────────────────────────────────────────────
  it('BAR-A: valid barcode → found: true, correct product returned', async () => {
    const barcode = uniqueBarcode('BARA');
    const { id } = await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.product._id).toBe(id);
    expect(res.body.product.barcode).toBe(barcode);
  }, 15_000);

  // ── BAR-B ──────────────────────────────────────────────────────────────────
  it('BAR-B: lowercase input → normalized to uppercase, found', async () => {
    const barcode = uniqueBarcode('BARB');
    await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    // Submit lowercase version — server must normalize
    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode.toLowerCase())}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.product.barcode).toBe(barcode);
  }, 15_000);

  // ── BAR-C ──────────────────────────────────────────────────────────────────
  it('BAR-C: input with leading/trailing spaces → trimmed and found', async () => {
    const barcode = uniqueBarcode('BARC');
    await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    // URL-encode a padded version — %20 on both sides
    const padded = `  ${barcode}  `;
    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(padded)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.product.barcode).toBe(barcode);
  }, 15_000);

  // ── BAR-D ──────────────────────────────────────────────────────────────────
  it('BAR-D: unknown barcode → 404, found: false', async () => {
    const barcode = uniqueBarcode('BARD');

    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(404);
    expect(res.body.found).toBe(false);
    expect(res.body.inactive).toBeFalsy();
  }, 10_000);

  // ── BAR-E ──────────────────────────────────────────────────────────────────
  it('BAR-E: inactive (isAvailable=false) product barcode → 404, found: false, inactive: true', async () => {
    const barcode = uniqueBarcode('BARE');
    const { id } = await createProductWithBarcode(adminTokenA, categoryIdA, barcode, {
      isAvailable: false,
    });
    expect(id).toBeDefined();

    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(404);
    expect(res.body.found).toBe(false);
    expect(res.body.inactive).toBe(true);
  }, 15_000);

  // ── BAR-F ──────────────────────────────────────────────────────────────────
  it('BAR-F: Hotel A barcode not returned to Hotel B (tenant isolation)', async () => {
    const barcode = uniqueBarcode('BARF');
    await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    // Hotel B token asking for Hotel A's barcode — must not find it
    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenB));

    expect(res.status).toBe(404);
    expect(res.body.found).toBe(false);
  }, 15_000);

  // ── BAR-G ──────────────────────────────────────────────────────────────────
  it('BAR-G: same barcode in different hotels → both resolve to their own product', async () => {
    const sharedBarcode = uniqueBarcode('BARG');

    const { id: idA } = await createProductWithBarcode(adminTokenA, categoryIdA, sharedBarcode);
    const { id: idB } = await createProductWithBarcode(adminTokenB, categoryIdB, sharedBarcode);

    const resA = await api
      .get(`/api/products/barcode/${encodeURIComponent(sharedBarcode)}`)
      .set(authHeaders(adminTokenA));
    const resB = await api
      .get(`/api/products/barcode/${encodeURIComponent(sharedBarcode)}`)
      .set(authHeaders(adminTokenB));

    expect(resA.status).toBe(200);
    expect(resA.body.found).toBe(true);
    expect(resA.body.product._id).toBe(idA);

    expect(resB.status).toBe(200);
    expect(resB.body.found).toBe(true);
    expect(resB.body.product._id).toBe(idB);
  }, 20_000);

  // ── BAR-H ──────────────────────────────────────────────────────────────────
  it('BAR-H: soft-deleted product barcode → 404, found: false', async () => {
    const barcode = uniqueBarcode('BARH');
    const { id } = await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    // Soft-delete the product
    const delRes = await api
      .delete(`/api/products/${id}`)
      .set(authHeaders(adminTokenA));
    expect([200, 204]).toContain(delRes.status);

    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(404);
    expect(res.body.found).toBe(false);
  }, 15_000);

  // ── BAR-I ──────────────────────────────────────────────────────────────────
  it('BAR-I: empty-barcode products are not matched by barcode lookup', async () => {
    // Create a product explicitly with empty barcode
    const payload = { ...productPayload(categoryIdA), barcode: '', price: 120 };
    const createRes = await api.post('/api/products').set(authHeaders(adminTokenA)).send(payload);
    expect(createRes.status).toBe(201);

    // Scenario 1: a non-empty lookup code should NOT return the empty-barcode product
    const randomCode = uniqueBarcode('BARI');
    const res1 = await api
      .get(`/api/products/barcode/${encodeURIComponent(randomCode)}`)
      .set(authHeaders(adminTokenA));
    expect(res1.status).toBe(404);
    expect(res1.body.found).toBe(false);

    // Scenario 2: a whitespace-only code normalizes to '' and must be rejected
    // %20 decodes to a space; server trims it to '', then returns 400
    const res2 = await api
      .get('/api/products/barcode/%20')
      .set(authHeaders(adminTokenA));
    expect([400, 404]).toContain(res2.status);
    if (res2.body.found !== undefined) {
      expect(res2.body.found).toBe(false);
    }
  }, 15_000);

  // ── BAR-J ──────────────────────────────────────────────────────────────────
  it('BAR-J: create product without barcode → set via PUT → lookup works', async () => {
    // Create without barcode
    const createRes = await api
      .post('/api/products')
      .set(authHeaders(adminTokenA))
      .send({ ...productPayload(categoryIdA), price: 200 });
    expect(createRes.status).toBe(201);
    const prod = createRes.body.product ?? createRes.body;
    const productId = prod._id;

    const barcode = uniqueBarcode('BARJ');

    // Set barcode via PUT
    const putRes = await api
      .put(`/api/products/${productId}`)
      .set(authHeaders(adminTokenA))
      .send({ barcode });
    expect(putRes.status).toBe(200);

    // Now lookup must work
    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.product._id).toBe(productId);
  }, 20_000);

  // ── BAR-K ──────────────────────────────────────────────────────────────────
  it('BAR-K: server returns DB price, not a fake client price', async () => {
    const barcode = uniqueBarcode('BARK');
    const dbPrice = 250;
    await createProductWithBarcode(adminTokenA, categoryIdA, barcode, { price: dbPrice });

    const res = await api
      .get(`/api/products/barcode/${encodeURIComponent(barcode)}`)
      .set(authHeaders(adminTokenA));

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    // Price comes from DB — the client has no way to influence it via this endpoint
    expect(res.body.product.price).toBe(dbPrice);
  }, 15_000);

  // ── BAR-L ──────────────────────────────────────────────────────────────────
  it('BAR-L: duplicate barcode within same hotel → rejected', async () => {
    const barcode = uniqueBarcode('BARL');
    await createProductWithBarcode(adminTokenA, categoryIdA, barcode);

    // Second product with same barcode in same hotel must fail
    const dupRes = await api
      .post('/api/products')
      .set(authHeaders(adminTokenA))
      .send({ ...productPayload(categoryIdA), barcode, price: 100 });

    expect([400, 409, 422]).toContain(dupRes.status);
  }, 15_000);

  // ── BAR-M ──────────────────────────────────────────────────────────────────
  it('BAR-M: unauthenticated barcode lookup → 401', async () => {
    const barcode = uniqueBarcode('BARM');

    const res = await api.get(`/api/products/barcode/${encodeURIComponent(barcode)}`);

    expect(res.status).toBe(401);
  }, 10_000);
});
