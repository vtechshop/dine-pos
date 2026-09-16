import { db } from './db';
import { getAuthCache } from './authDao';

const currentHotelId = (): string => getAuthCache()?.hotelId ?? '';

export const saveCartSnapshot = (cartData: object): void => {
  const hotelId = currentHotelId();
  db.runSync(
    `INSERT INTO cart_snapshot (id, hotel_id, data, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       hotel_id   = excluded.hotel_id,
       data       = excluded.data,
       updated_at = excluded.updated_at`,
    [hotelId, JSON.stringify(cartData), new Date().toISOString()],
  );
};

export const getCartSnapshot = (): object | null => {
  const hotelId = currentHotelId();
  const row = db.getFirstSync<{ data: string | null; hotel_id: string }>(
    'SELECT data, hotel_id FROM cart_snapshot WHERE id = 1',
  );
  // Discard snapshot if it belongs to a different hotel session
  if (!row?.data || (hotelId && row.hotel_id !== hotelId)) return null;
  try { return JSON.parse(row.data); } catch { return null; }
};

export const clearCartSnapshot = (): void => {
  db.runSync(
    'UPDATE cart_snapshot SET data = NULL, updated_at = ? WHERE id = 1',
    [new Date().toISOString()],
  );
};
