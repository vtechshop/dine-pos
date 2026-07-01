import { db } from './db';
import { Product, Category, Table, Settings, Customer } from '../types';

const now = () => new Date().toISOString();

// ── Products ─────────────────────────────────────────────────────────────────

export const saveProducts = (products: Product[]): void => {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM local_products');
    for (const p of products) {
      db.runSync(
        'INSERT INTO local_products (id, data, synced_at) VALUES (?, ?, ?)',
        [p._id, JSON.stringify(p), now()],
      );
    }
  });
};

export const getLocalProducts = (): Product[] => {
  const rows = db.getAllSync<{ data: string }>('SELECT data FROM local_products');
  return rows.map(r => JSON.parse(r.data) as Product);
};

export const updateLocalProductStock = (productId: string, newStock: number): void => {
  const row = db.getFirstSync<{ data: string }>(
    'SELECT data FROM local_products WHERE id = ?', [productId],
  );
  if (!row) return;
  const product = JSON.parse(row.data) as Product;
  product.stock = newStock;
  if (newStock === 0) product.isAvailable = false;
  db.runSync(
    'UPDATE local_products SET data = ? WHERE id = ?',
    [JSON.stringify(product), productId],
  );
};

// ── Categories ───────────────────────────────────────────────────────────────

export const saveCategories = (categories: Category[]): void => {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM local_categories');
    for (const c of categories) {
      db.runSync(
        'INSERT INTO local_categories (id, data, synced_at) VALUES (?, ?, ?)',
        [c._id, JSON.stringify(c), now()],
      );
    }
  });
};

export const getLocalCategories = (): Category[] => {
  const rows = db.getAllSync<{ data: string }>(
    'SELECT data FROM local_categories ORDER BY json_extract(data, "$.sortOrder") ASC',
  );
  return rows.map(r => JSON.parse(r.data) as Category);
};

// ── Tables ───────────────────────────────────────────────────────────────────

export const saveTables = (tables: Table[]): void => {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM local_tables');
    for (const t of tables) {
      db.runSync(
        'INSERT INTO local_tables (id, data, synced_at) VALUES (?, ?, ?)',
        [t._id, JSON.stringify(t), now()],
      );
    }
  });
};

export const getLocalTables = (): Table[] => {
  const rows = db.getAllSync<{ data: string }>('SELECT data FROM local_tables');
  return rows.map(r => JSON.parse(r.data) as Table);
};

// ── Settings ─────────────────────────────────────────────────────────────────

export const saveLocalSettings = (settings: Settings): void => {
  db.runSync(
    `INSERT INTO local_settings (id, data, synced_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`,
    [JSON.stringify(settings), now()],
  );
};

export const getLocalSettings = (): Settings | null => {
  const row = db.getFirstSync<{ data: string }>('SELECT data FROM local_settings WHERE id = 1');
  return row ? (JSON.parse(row.data) as Settings) : null;
};

// ── Customers ────────────────────────────────────────────────────────────────

export const saveCustomers = (customers: Customer[]): void => {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM local_customers');
    for (const c of customers) {
      db.runSync(
        'INSERT INTO local_customers (phone, data, synced_at) VALUES (?, ?, ?)',
        [c.phone, JSON.stringify(c), now()],
      );
    }
  });
};

export const getLocalCustomers = (): Customer[] => {
  const rows = db.getAllSync<{ data: string }>('SELECT data FROM local_customers');
  return rows.map(r => JSON.parse(r.data) as Customer);
};

// ── Sync metadata ────────────────────────────────────────────────────────────

export const setSyncMeta = (key: string, value: string): void => {
  db.runSync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
};

export const getSyncMeta = (key: string): string | null => {
  const row = db.getFirstSync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?', [key],
  );
  return row?.value ?? null;
};
