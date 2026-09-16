import { getDb } from './offlineDb';
import type { Product, Category } from '../types';

export async function cacheProducts(hotelId: string, products: Product[]): Promise<void> {
  // An empty list likely means the server request failed or returned nothing useful.
  // Never wipe a valid cache on a silent failure — stale products are better than none.
  if (products.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('products', 'readwrite');
  const existingKeys = await tx.store.index('by-hotel').getAllKeys(hotelId);
  await Promise.all(existingKeys.map(k => tx.store.delete(k)));
  await Promise.all(products.map(p => tx.store.put({ ...p, hotelId })));
  await tx.done;
}

export async function getLocalProducts(hotelId: string): Promise<Product[]> {
  const db = await getDb();
  return db.getAllFromIndex('products', 'by-hotel', hotelId);
}

export async function cacheCategories(hotelId: string, categories: Category[]): Promise<void> {
  if (categories.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('categories', 'readwrite');
  const existingKeys = await tx.store.index('by-hotel').getAllKeys(hotelId);
  await Promise.all(existingKeys.map(k => tx.store.delete(k)));
  await Promise.all(categories.map(c => tx.store.put({ ...c, hotelId })));
  await tx.done;
}

export async function getLocalCategories(hotelId: string): Promise<Category[]> {
  const db = await getDb();
  return db.getAllFromIndex('categories', 'by-hotel', hotelId);
}

export async function setSyncMeta(hotelId: string, resource: string): Promise<void> {
  const db = await getDb();
  await db.put('syncMeta', {
    key: `${hotelId}:${resource}`,
    hotelId,
    syncedAt: new Date().toISOString(),
  });
}

export async function getSyncMeta(hotelId: string, resource: string): Promise<string | null> {
  const db = await getDb();
  const meta = await db.get('syncMeta', `${hotelId}:${resource}`);
  return meta?.syncedAt ?? null;
}
