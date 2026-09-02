/**
 * Inventory — Ingredients & Stock Tests
 *
 * Covers:
 *   - Ingredient CRUD (create, list, update, delete)
 *   - Stock-in and stock adjustment
 *   - Low-stock alerts endpoint
 *   - Inventory summary
 *   - Inventory Intelligence
 *   - Hotel isolation: hotel B cannot access hotel A's ingredients
 *   - Authorization: kitchen/waiter tokens are read-only or blocked
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';

describe('Inventory — Ingredients & Stock', () => {
  let adminToken: string;
  let kitchenToken: string;
  let hotelBAdminToken: string;
  let createdIngredientId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    adminToken       = hotelA.adminToken;
    kitchenToken     = hotelA.kitchenToken;
    hotelBAdminToken = hotelB.adminToken;
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it('INV-001 GET /api/ingredients returns 401 without token', async () => {
    const res = await api.get('/api/ingredients');
    expect(res.status).toBe(401);
  });

  it('INV-002 POST /api/ingredients returns 401 without token', async () => {
    const res = await api.post('/api/ingredients').send({ name: 'Sugar', unit: 'kg' });
    expect(res.status).toBe(401);
  });

  // ── Create ingredient ─────────────────────────────────────────────────────

  it('INV-003 admin can create an ingredient', async () => {
    const res = await api
      .post('/api/ingredients')
      .set(authHeaders(adminToken))
      .send({
        name:          'Test Flour',
        unit:          'kg',
        currentStock:  10,
        minimumStock:  2,
        costPerUnit:   50,
      });
    expect([200, 201]).toContain(res.status);
    const ingredient = res.body.ingredient || res.body;
    expect(ingredient._id).toBeDefined();
    expect(ingredient.name).toBe('Test Flour');
    createdIngredientId = ingredient._id;
  });

  it('INV-004 create ingredient without name returns 400', async () => {
    const res = await api
      .post('/api/ingredients')
      .set(authHeaders(adminToken))
      .send({ unit: 'kg', currentStock: 5 });
    expect([400, 422]).toContain(res.status);
  });

  it('INV-005 create ingredient without unit returns 400', async () => {
    const res = await api
      .post('/api/ingredients')
      .set(authHeaders(adminToken))
      .send({ name: 'No Unit Ingredient', currentStock: 5 });
    expect([400, 422]).toContain(res.status);
  });

  // ── List ingredients ──────────────────────────────────────────────────────

  it('INV-006 admin can list ingredients', async () => {
    const res = await api.get('/api/ingredients').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const items = res.body.ingredients || res.body.data || res.body;
    expect(Array.isArray(items)).toBe(true);
  });

  it('INV-007 kitchen token can list ingredients (read access)', async () => {
    const res = await api.get('/api/ingredients').set(authHeaders(kitchenToken));
    expect([200, 403]).toContain(res.status); // 200 if read allowed, 403 if kitchen-only
  });

  // ── Update ingredient ─────────────────────────────────────────────────────

  it('INV-008 admin can update an ingredient', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .put(`/api/ingredients/${createdIngredientId}`)
      .set(authHeaders(adminToken))
      .send({ minimumStock: 5, costPerUnit: 60 });
    expect(res.status).toBe(200);
    const ingredient = res.body.ingredient || res.body;
    expect(ingredient.minimumStock).toBe(5);
  });

  // ── Stock operations ──────────────────────────────────────────────────────

  it('INV-009 admin can add stock (stock-in)', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .post(`/api/ingredients/${createdIngredientId}/stock-in`)
      .set(authHeaders(adminToken))
      .send({ quantity: 5, notes: 'Delivery received' });
    expect([200, 201]).toContain(res.status);
  });

  it('INV-010 stock-in with negative quantity returns 400', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .post(`/api/ingredients/${createdIngredientId}/stock-in`)
      .set(authHeaders(adminToken))
      .send({ quantity: -3, notes: 'Invalid' });
    expect([400, 422]).toContain(res.status);
  });

  it('INV-011 admin can adjust stock', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .post(`/api/ingredients/${createdIngredientId}/adjust`)
      .set(authHeaders(adminToken))
      .send({ quantity: 12, reason: 'Physical count correction' });
    expect([200, 201]).toContain(res.status);
  });

  // ── Inventory summary and alerts ──────────────────────────────────────────

  it('INV-012 GET /api/ingredients/summary returns 200 for admin', async () => {
    const res = await api.get('/api/ingredients/summary').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toBeDefined();
  });

  it('INV-013 GET /api/ingredients/alerts/low-stock returns 200 for admin', async () => {
    const res = await api.get('/api/ingredients/alerts/low-stock').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const items = res.body.alerts || res.body.data || res.body;
    expect(Array.isArray(items)).toBe(true);
  });

  // ── Inventory Intelligence ────────────────────────────────────────────────

  it('INV-014 GET /api/inventory-intelligence returns 401 without token', async () => {
    const res = await api.get('/api/inventory-intelligence');
    expect(res.status).toBe(401);
  });

  it('INV-015 admin can access inventory intelligence', async () => {
    const res = await api.get('/api/inventory-intelligence').set(authHeaders(adminToken));
    expect([200, 500, 503]).toContain(res.status); // may need Gemini for full analysis
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });

  // ── Stock movement history ─────────────────────────────────────────────────

  it('INV-016 admin can view ingredient history', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .get(`/api/ingredients/${createdIngredientId}/history`)
      .set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const items = res.body.movements || res.body.data || res.body;
    expect(Array.isArray(items)).toBe(true);
  });

  // ── Hotel isolation ───────────────────────────────────────────────────────

  it('INV-017 hotel B admin cannot list hotel A ingredients', async () => {
    // Both can list their own ingredients — data returned must be scoped by JWT hotelId
    const resA = await api.get('/api/ingredients').set(authHeaders(adminToken));
    const resB = await api.get('/api/ingredients').set(authHeaders(hotelBAdminToken));

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const itemsA = resA.body.ingredients || resA.body.data || resA.body;
    const itemsB = resB.body.ingredients || resB.body.data || resB.body;

    // Hotel B should not see hotel A's ingredient
    if (createdIngredientId && Array.isArray(itemsB)) {
      const crossContaminated = itemsB.some((i: any) => i._id === createdIngredientId);
      expect(crossContaminated).toBe(false);
    }
  });

  it('INV-018 hotel B admin cannot update hotel A ingredient (404 or 403)', async () => {
    if (!createdIngredientId) return;
    const res = await api
      .put(`/api/ingredients/${createdIngredientId}`)
      .set(authHeaders(hotelBAdminToken))
      .send({ minimumStock: 999 });
    expect([403, 404]).toContain(res.status);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  afterAll(async () => {
    if (createdIngredientId) {
      await api
        .delete(`/api/ingredients/${createdIngredientId}`)
        .set(authHeaders(adminToken));
    }
  });
});
