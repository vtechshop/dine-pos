import { api } from '../../utils/api-client';
import { authHeaders } from '../../utils/env';
import { categoryPayload, productPayload } from '../../utils/test-data';

export interface CreatedCategory {
  id: string;
  name: string;
}

export interface CreatedProduct {
  id: string;
  name: string;
  price: number;
  categoryId: string;
}

export async function createCategory(
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<CreatedCategory> {
  const payload = categoryPayload(overrides);
  const res = await api.post('/api/categories').set(authHeaders(token)).send(payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createCategory failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.category?._id || res.body._id;
  return { id, name: payload.name as string };
}

export async function createProduct(
  token: string,
  categoryId: string,
  overrides: Record<string, unknown> = {}
): Promise<CreatedProduct> {
  const payload = productPayload(categoryId, overrides);
  const res = await api.post('/api/products').set(authHeaders(token)).send(payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.product?._id || res.body._id;
  return { id, name: payload.name as string, price: payload.price as number, categoryId };
}

export async function getCategories(token: string): Promise<any[]> {
  const res = await api.get('/api/categories').set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getCategories failed: ${res.status}`);
  return res.body.categories || res.body.data || res.body;
}

export async function getProducts(token: string): Promise<any[]> {
  const res = await api.get('/api/products').set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getProducts failed: ${res.status}`);
  return res.body.products || res.body.data || res.body;
}

export async function getPublicMenu(hotelId: string): Promise<any> {
  const res = await api.get('/api/public/menu').query({ hotel: hotelId });
  if (res.status !== 200) throw new Error(`getPublicMenu failed: ${res.status}`);
  return res.body;
}

export async function seedMenuForHotel(token: string): Promise<{
  category: CreatedCategory;
  products: CreatedProduct[];
}> {
  const category = await createCategory(token);
  const [p1, p2, p3] = await Promise.all([
    createProduct(token, category.id, { name: 'Paneer Tikka', price: 220, isAvailable: true }),
    createProduct(token, category.id, { name: 'Dal Makhani', price: 160, isAvailable: true }),
    createProduct(token, category.id, { name: 'Garlic Naan', price: 45, isAvailable: true }),
  ]);
  return { category, products: [p1, p2, p3] };
}
