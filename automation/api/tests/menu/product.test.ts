import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { productPayload } from '../../../utils/test-data';

describe('Menu — Products', () => {
  let adminToken: string;
  let kitchenToken: string;
  let categoryId: string;
  let createdProductId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    categoryId = hotelA.categoryId;
  });

  describe('POST /api/products', () => {
    it('PRD-001 admin creates product and receives 201 with id', async () => {
      const res = await api.post('/api/products').set(authHeaders(adminToken)).send(productPayload(categoryId));
      expect(res.status).toBe(201);
      const prod = res.body.product || res.body;
      expect(prod._id).toBeDefined();
      createdProductId = prod._id;
    });

    it('PRD-002 non-admin cannot create product', async () => {
      const res = await api.post('/api/products').set(authHeaders(kitchenToken)).send(productPayload(categoryId));
      expect([401, 403]).toContain(res.status);
    });

    it('PRD-003 missing name returns 400', async () => {
      const res = await api.post('/api/products').set(authHeaders(adminToken)).send({ price: 100, category: categoryId });
      expect([400, 422]).toContain(res.status);
    });

    it('PRD-004 missing price returns 400', async () => {
      const res = await api.post('/api/products').set(authHeaders(adminToken)).send({ name: 'Test', category: categoryId });
      expect([400, 422]).toContain(res.status);
    });

    it('PRD-005 negative price returns 400 or 422', async () => {
      const res = await api.post('/api/products').set(authHeaders(adminToken)).send(productPayload(categoryId, { price: -50 }));
      expect([400, 422]).toContain(res.status);
    });

    it('PRD-006 unauthenticated cannot create product', async () => {
      const res = await api.post('/api/products').send(productPayload(categoryId));
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/products', () => {
    it('PRD-007 admin can list products', async () => {
      const res = await api.get('/api/products').set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      const prods = res.body.products || res.body.data || res.body;
      expect(Array.isArray(prods)).toBe(true);
    });

    it('PRD-008 kitchen can list products', async () => {
      const res = await api.get('/api/products').set(authHeaders(kitchenToken));
      expect(res.status).toBe(200);
    });

    it('PRD-009 products list does not contain items from other hotels', async () => {
      const { getHotelB } = await import('../../setup/testEnv');
      const hotelB = getHotelB();
      const resB = await api.get('/api/products').set(authHeaders(hotelB.adminToken));
      const prodsB = resB.body.products || resB.body.data || resB.body;
      const hotelAProductExists = prodsB.some((p: any) => p._id === createdProductId);
      expect(hotelAProductExists).toBe(false);
    });
  });

  describe('GET /api/products/:id', () => {
    it('PRD-010 admin can get single product', async () => {
      const res = await api.get(`/api/products/${createdProductId}`).set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      const prod = res.body.product || res.body;
      expect(prod._id).toBe(createdProductId);
    });

    it('PRD-011 returns 404 for nonexistent product', async () => {
      const res = await api.get('/api/products/000000000000000000000000').set(authHeaders(adminToken));
      expect([404, 400]).toContain(res.status);
    });
  });

  describe('PUT /api/products/:id', () => {
    it('PRD-012 admin can update product price', async () => {
      const res = await api
        .put(`/api/products/${createdProductId}`)
        .set(authHeaders(adminToken))
        .send({ price: 999 });
      expect(res.status).toBe(200);
      const prod = res.body.product || res.body;
      expect(prod.price).toBe(999);
    });

    it('PRD-013 admin can toggle product availability', async () => {
      const res = await api
        .put(`/api/products/${createdProductId}`)
        .set(authHeaders(adminToken))
        .send({ isAvailable: false });
      expect(res.status).toBe(200);
      const prod = res.body.product || res.body;
      expect(prod.isAvailable).toBe(false);
    });

    it('PRD-014 non-admin cannot update product', async () => {
      const res = await api
        .put(`/api/products/${createdProductId}`)
        .set(authHeaders(kitchenToken))
        .send({ price: 1 });
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('PRD-015 admin can delete product', async () => {
      const createRes = await api.post('/api/products').set(authHeaders(adminToken)).send(productPayload(categoryId));
      const id = createRes.body.product?._id || createRes.body._id;
      const res = await api.delete(`/api/products/${id}`).set(authHeaders(adminToken));
      expect([200, 204]).toContain(res.status);
    });

    it('PRD-016 non-admin cannot delete product', async () => {
      const res = await api.delete(`/api/products/${createdProductId}`).set(authHeaders(kitchenToken));
      expect([401, 403]).toContain(res.status);
    });
  });
});
