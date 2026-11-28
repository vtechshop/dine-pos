// In-process menu cache — 5-minute TTL, sub-ms reads, no external dependencies.
// Safe for single-instance deployments (Render Web Service).
const _cache = new Map<string, { data: any[]; exp: number }>();
const TTL_MS = 5 * 60 * 1000;

export const menuCacheGet = (key: string): any[] | null => {
  const entry = _cache.get(key);
  if (!entry || entry.exp < Date.now()) { _cache.delete(key); return null; }
  return entry.data;
};

export const menuCacheSet = (key: string, data: any[]): void => {
  _cache.set(key, { data, exp: Date.now() + TTL_MS });
};

export const menuCacheDel = (key: string): void => { _cache.delete(key); };

/** Phase 5 · Batch 6 (P4-INV-04): drop the cached product list (same key as productRoutes) after a
 *  sale or cancellation changes counted stock, so the POS never shows a sold-out dish as available. */
export const invalidateProductList = (hotelId: string): void => menuCacheDel(`products:${hotelId}`);
