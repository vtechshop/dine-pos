import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDbForTesting } from '../offlineDb';
import {
  cacheProducts, getLocalProducts,
  cacheCategories, getLocalCategories,
  setSyncMeta, getSyncMeta,
} from '../productCache';
import { saveCart, loadCart, clearCartDb } from '../cartPersistence';
import type { Product, Category } from '../../types';

function makeProduct(id: string, name: string): Product {
  return {
    _id: id, name, price: 100, category: null, taxPercent: 5, hsnCode: '',
    image: '', isAvailable: true, isVeg: true, shortCode: '', barcode: '',
    description: '', stock: -1, isDeleted: false, createdAt: '', updatedAt: '',
  };
}

function makeCategory(id: string, name: string): Category {
  return {
    _id: id, name, icon: '', color: '#fff', isActive: true, sortOrder: 0,
    createdAt: '', updatedAt: '',
  };
}

beforeEach(() => {
  resetDbForTesting();
});

// ── OFF1: DB opens ───────────────────────────────────────────────────────────
describe('OFF1', () => {
  it('getDb returns a live IDBPDatabase instance', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    expect(db.name).toBe('dinepos-offline');
  });
});

// ── OFF2: products store ─────────────────────────────────────────────────────
describe('OFF2', () => {
  it('products store is accessible', async () => {
    const db = await getDb();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('products');
  });
});

// ── OFF3: categories store ───────────────────────────────────────────────────
describe('OFF3', () => {
  it('categories store is accessible', async () => {
    const db = await getDb();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('categories');
  });
});

// ── OFF4: cart store ─────────────────────────────────────────────────────────
describe('OFF4', () => {
  it('cart store is accessible', async () => {
    const db = await getDb();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('cart');
  });
});

// ── OFF5: syncMeta store ─────────────────────────────────────────────────────
describe('OFF5', () => {
  it('syncMeta store is accessible', async () => {
    const db = await getDb();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('syncMeta');
  });
});

// ── OFF6: cacheProducts stores records scoped to hotelId ─────────────────────
describe('OFF6', () => {
  it('cacheProducts stores products with hotelId tag', async () => {
    const products = [makeProduct('p1', 'Burger'), makeProduct('p2', 'Pizza')];
    await cacheProducts('hotel-a', products);
    const cached = await getLocalProducts('hotel-a');
    expect(cached).toHaveLength(2);
    expect(cached.map(p => p._id).sort()).toEqual(['p1', 'p2']);
  });
});

// ── OFF7: getLocalProducts returns [] for unknown hotel ──────────────────────
describe('OFF7', () => {
  it('getLocalProducts returns empty array for hotel with no cache', async () => {
    const result = await getLocalProducts('hotel-unknown');
    expect(result).toEqual([]);
  });
});

// ── OFF8: getLocalProducts returns only that hotel's products ─────────────────
describe('OFF8', () => {
  it('getLocalProducts is scoped to hotelId', async () => {
    await cacheProducts('hotel-a', [makeProduct('p1', 'Burger')]);
    await cacheProducts('hotel-b', [makeProduct('p2', 'Pasta'), makeProduct('p3', 'Salad')]);
    const forA = await getLocalProducts('hotel-a');
    expect(forA).toHaveLength(1);
    expect(forA[0]._id).toBe('p1');
    const forB = await getLocalProducts('hotel-b');
    expect(forB).toHaveLength(2);
  });
});

// ── OFF9: cacheProducts replaces existing products ───────────────────────────
describe('OFF9', () => {
  it('cacheProducts replaces existing cache for same hotel', async () => {
    await cacheProducts('hotel-a', [makeProduct('p1', 'Burger'), makeProduct('p2', 'Pizza')]);
    await cacheProducts('hotel-a', [makeProduct('p3', 'Tacos')]);
    const cached = await getLocalProducts('hotel-a');
    expect(cached).toHaveLength(1);
    expect(cached[0]._id).toBe('p3');
  });
});

// ── OFF10: cacheCategories stores categories scoped to hotelId ───────────────
describe('OFF10', () => {
  it('cacheCategories stores categories with hotelId tag', async () => {
    const cats = [makeCategory('c1', 'Starters'), makeCategory('c2', 'Mains')];
    await cacheCategories('hotel-a', cats);
    const cached = await getLocalCategories('hotel-a');
    expect(cached).toHaveLength(2);
  });
});

// ── OFF11: getLocalCategories is scoped to hotelId ───────────────────────────
describe('OFF11', () => {
  it('getLocalCategories returns only that hotel categories', async () => {
    await cacheCategories('hotel-a', [makeCategory('c1', 'Starters')]);
    await cacheCategories('hotel-b', [makeCategory('c2', 'Desserts'), makeCategory('c3', 'Drinks')]);
    const forA = await getLocalCategories('hotel-a');
    expect(forA).toHaveLength(1);
    expect(forA[0]._id).toBe('c1');
  });
});

// ── OFF12: setSyncMeta + getSyncMeta round-trip ──────────────────────────────
describe('OFF12', () => {
  it('setSyncMeta persists and getSyncMeta retrieves timestamp', async () => {
    await setSyncMeta('hotel-a', 'products');
    const ts = await getSyncMeta('hotel-a', 'products');
    expect(ts).not.toBeNull();
    expect(new Date(ts!).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

// ── OFF13: getSyncMeta returns null for unknown key ──────────────────────────
describe('OFF13', () => {
  it('getSyncMeta returns null when no meta set', async () => {
    const ts = await getSyncMeta('hotel-x', 'products');
    expect(ts).toBeNull();
  });
});

// ── OFF14: hotel isolation — products ────────────────────────────────────────
describe('OFF14', () => {
  it('hotel A products are not returned for hotel B', async () => {
    await cacheProducts('hotel-a', [makeProduct('p1', 'Item A'), makeProduct('p2', 'Item B')]);
    const forB = await getLocalProducts('hotel-b');
    expect(forB).toHaveLength(0);
  });
});

// ── OFF15: saveCart persists items ───────────────────────────────────────────
describe('OFF15', () => {
  it('saveCart persists cart items for a hotel', async () => {
    const items = [{ id: 'line1', productId: 'p1', quantity: 2, price: 100 }];
    await saveCart('hotel-a', items);
    const loaded = await loadCart('hotel-a');
    expect(loaded).toHaveLength(1);
    expect((loaded[0] as typeof items[0]).id).toBe('line1');
  });
});

// ── OFF16: loadCart returns [] when nothing saved ────────────────────────────
describe('OFF16', () => {
  it('loadCart returns empty array when no cart saved', async () => {
    const result = await loadCart('hotel-no-cart');
    expect(result).toEqual([]);
  });
});

// ── OFF17: clearCartDb removes the cart record ───────────────────────────────
describe('OFF17', () => {
  it('clearCartDb removes persisted cart', async () => {
    await saveCart('hotel-a', [{ id: 'line1', quantity: 1 }]);
    await clearCartDb('hotel-a');
    const result = await loadCart('hotel-a');
    expect(result).toEqual([]);
  });
});
