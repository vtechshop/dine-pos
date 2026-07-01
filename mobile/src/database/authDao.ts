import { db } from './db';

export interface CachedAuth {
  jwt: string;
  hotelId: string;
  hotelName: string;
  cachedAt: string;
}

export const saveAuthCache = (jwt: string, hotelId: string, hotelName: string): void => {
  db.runSync(
    `INSERT INTO auth_cache (id, jwt, hotel_id, hotel_name, cached_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       jwt       = excluded.jwt,
       hotel_id  = excluded.hotel_id,
       hotel_name= excluded.hotel_name,
       cached_at = excluded.cached_at`,
    [jwt, hotelId, hotelName, new Date().toISOString()],
  );
};

export const getAuthCache = (): CachedAuth | null => {
  const row = db.getFirstSync<{
    jwt: string; hotel_id: string; hotel_name: string; cached_at: string;
  }>('SELECT jwt, hotel_id, hotel_name, cached_at FROM auth_cache WHERE id = 1');

  if (!row) return null;
  return { jwt: row.jwt, hotelId: row.hotel_id, hotelName: row.hotel_name, cachedAt: row.cached_at };
};

export const clearAuthCache = (): void => {
  db.runSync('DELETE FROM auth_cache WHERE id = 1');
};
