import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { categoryPayload } from '../../../utils/test-data';

describe('Menu — Categories', () => {
  let adminToken: string;
  let kitchenToken: string;
  let createdCategoryId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
  });

  describe('POST /api/categories', () => {
    it('CAT-001 admin can create a category and receives 201 with id', async () => {
      const res = await api.post('/api/categories').set(authHeaders(adminToken)).send(categoryPayload());
      expect(res.status).toBe(201);
      const cat = res.body.category || res.body;
      expect(cat._id).toBeDefined();
      expect(cat.name).toBeDefined();
      createdCategoryId = cat._id;
    });

    it('CAT-002 non-admin (kitchen) cannot create category', async () => {
      const res = await api.post('/api/categories').set(authHeaders(kitchenToken)).send(categoryPayload());
      expect([401, 403]).toContain(res.status);
    });

    it('CAT-003 missing name returns 400', async () => {
      const res = await api.post('/api/categories').set(authHeaders(adminToken)).send({ color: '#FF0000' });
      expect([400, 422]).toContain(res.status);
    });

    it('CAT-004 unauthenticated request returns 401', async () => {
      const res = await api.post('/api/categories').send(categoryPayload());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/categories', () => {
    it('CAT-005 admin can list categories and response is array', async () => {
      const res = await api.get('/api/categories').set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      const cats = res.body.categories || res.body.data || res.body;
      expect(Array.isArray(cats)).toBe(true);
    });

    it('CAT-006 kitchen can list categories', async () => {
      const res = await api.get('/api/categories').set(authHeaders(kitchenToken));
      expect(res.status).toBe(200);
    });

    it('CAT-007 unauthenticated cannot list categories', async () => {
      const res = await api.get('/api/categories');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/categories/:id', () => {
    it('CAT-008 admin can update category name', async () => {
      const newName = 'Updated Category Name';
      const res = await api
        .put(`/api/categories/${createdCategoryId}`)
        .set(authHeaders(adminToken))
        .send({ name: newName });
      expect(res.status).toBe(200);
      const cat = res.body.category || res.body;
      expect(cat.name).toBe(newName);
    });

    it('CAT-009 non-admin cannot update category', async () => {
      const res = await api
        .put(`/api/categories/${createdCategoryId}`)
        .set(authHeaders(kitchenToken))
        .send({ name: 'Hack' });
      expect([401, 403]).toContain(res.status);
    });

    it('CAT-010 update nonexistent category returns 404', async () => {
      const res = await api
        .put('/api/categories/000000000000000000000000')
        .set(authHeaders(adminToken))
        .send({ name: 'Ghost' });
      expect([404, 400]).toContain(res.status);
    });
  });

  describe('DELETE /api/categories/:id', () => {
    it('CAT-011 admin can delete category', async () => {
      const createRes = await api.post('/api/categories').set(authHeaders(adminToken)).send(categoryPayload());
      const id = createRes.body.category?._id || createRes.body._id;
      const res = await api.delete(`/api/categories/${id}`).set(authHeaders(adminToken));
      expect([200, 204]).toContain(res.status);
    });

    it('CAT-012 non-admin cannot delete category', async () => {
      const res = await api.delete(`/api/categories/${createdCategoryId}`).set(authHeaders(kitchenToken));
      expect([401, 403]).toContain(res.status);
    });
  });
});
