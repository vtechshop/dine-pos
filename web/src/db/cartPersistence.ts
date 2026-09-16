import { getDb } from './offlineDb';

export async function saveCart(hotelId: string, items: unknown[]): Promise<void> {
  const db = await getDb();
  await db.put('cart', { hotelId, items, savedAt: new Date().toISOString() });
}

export async function loadCart(hotelId: string): Promise<unknown[]> {
  const db = await getDb();
  const record = await db.get('cart', hotelId);
  return record?.items ?? [];
}

export async function clearCartDb(hotelId: string): Promise<void> {
  const db = await getDb();
  await db.delete('cart', hotelId);
}
