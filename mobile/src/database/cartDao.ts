import { db } from './db';

export const saveCartSnapshot = (cartData: object): void => {
  db.runSync(
    `INSERT INTO cart_snapshot (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(cartData), new Date().toISOString()],
  );
};

export const getCartSnapshot = (): object | null => {
  const row = db.getFirstSync<{ data: string | null }>(
    'SELECT data FROM cart_snapshot WHERE id = 1',
  );
  if (!row?.data) return null;
  try { return JSON.parse(row.data); } catch { return null; }
};

export const clearCartSnapshot = (): void => {
  db.runSync('UPDATE cart_snapshot SET data = NULL, updated_at = ? WHERE id = 1',
    [new Date().toISOString()]);
};
