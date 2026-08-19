import { db } from './db';

export interface QueuedCashierOrder {
  id:         number;
  offlineId:  string;
  payload:    object;
  status:     'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  createdAt:  string;
  lastError:  string | null;
}

type RawRow = {
  id:          number;
  offline_id:  string;
  payload:     string;
  status:      string;
  created_at:  string;
  retry_count: number;
  last_error:  string | null;
};

const parseRow = (r: RawRow): QueuedCashierOrder | null => {
  try {
    return {
      id:         r.id,
      offlineId:  r.offline_id,
      payload:    JSON.parse(r.payload),
      status:     r.status as QueuedCashierOrder['status'],
      retryCount: r.retry_count,
      createdAt:  r.created_at,
      lastError:  r.last_error,
    };
  } catch {
    // Permanently fail the row so it can never block the queue again.
    db.runSync(
      `UPDATE cashier_order_queue SET status='failed', last_error='Corrupt payload JSON', retry_count=99 WHERE offline_id=?`,
      [r.offline_id],
    );
    return null;
  }
};

// ── Write ─────────────────────────────────────────────────────────────────────

export const enqueueOrder = (offlineId: string, payload: object): void => {
  db.runSync(
    'INSERT OR IGNORE INTO cashier_order_queue (offline_id, payload) VALUES (?, ?)',
    [offlineId, JSON.stringify(payload)],
  );
};

export const markSynced = (offlineId: string): void => {
  db.runSync(
    "UPDATE cashier_order_queue SET status='synced' WHERE offline_id=?",
    [offlineId],
  );
};

export const markFailed = (offlineId: string, error: string): void => {
  db.runSync(
    "UPDATE cashier_order_queue SET status='failed', retry_count=retry_count+1, last_error=? WHERE offline_id=?",
    [error, offlineId],
  );
};

// ── Read ──────────────────────────────────────────────────────────────────────

// Returns rows eligible for the next sync attempt (pending or failed, < 5 retries).
export const getPendingOrders = (): QueuedCashierOrder[] => {
  const rows = db.getAllSync<RawRow>(
    "SELECT * FROM cashier_order_queue WHERE status IN ('pending','failed') AND retry_count < 5 ORDER BY created_at ASC",
  );
  return rows.map(parseRow).filter((r): r is QueuedCashierOrder => r !== null);
};

// Count shown in the CashierDashboard banner. Synchronous — safe to call on
// the JS thread without awaiting.
export const getPendingCount = (): number => {
  const row = db.getFirstSync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM cashier_order_queue WHERE status IN ('pending','failed') AND retry_count < 5",
  );
  return row?.cnt ?? 0;
};
