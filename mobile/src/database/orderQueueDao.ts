import { db } from './db';

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedOrder {
  id: string;
  offlineId: string | null;
  payload: object;
  status: QueueStatus;
  retries: number;
  nextAttempt: string | null;
  createdAt: string;
  syncedAt: string | null;
  error: string | null;
}

// Exponential backoff: 30s → 60s → 120s → … → cap 1800s
const backoffSeconds = (retries: number): number =>
  Math.min(30 * Math.pow(2, retries), 1800);

const nextAttemptTime = (retries: number): string =>
  new Date(Date.now() + backoffSeconds(retries) * 1000).toISOString();

// Safe row-to-domain mapping: corrupt JSON permanently fails that row so it
// cannot block subsequent orders. Returns null for corrupt rows.
type RawRow = {
  id: string; offline_id: string | null; payload: string; status: string;
  retries: number; next_attempt: string | null; created_at: string;
  synced_at: string | null; error: string | null;
};

const parseRow = (r: RawRow): QueuedOrder | null => {
  try {
    return {
      id:          r.id,
      offlineId:   r.offline_id,
      payload:     JSON.parse(r.payload),
      status:      r.status as QueueStatus,
      retries:     r.retries,
      nextAttempt: r.next_attempt,
      createdAt:   r.created_at,
      syncedAt:    r.synced_at,
      error:       r.error,
    };
  } catch {
    // Permanently fail so it never blocks the queue again.
    db.runSync(
      `UPDATE order_queue
       SET status = 'failed', error = 'Corrupt payload JSON', retries = 99
       WHERE id = ?`,
      [r.id],
    );
    return null;
  }
};

// ── Write ─────────────────────────────────────────────────────────────────────

// enqueueOrder uses the generated id as offline_id — same value sent to the
// server as the idempotency key so retry never creates a duplicate order.
export const enqueueOrder = (payload: object): string => {
  const id  = `oq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO order_queue (id, offline_id, payload, status, retries, next_attempt, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
    [id, id, JSON.stringify(payload), now, now],
  );
  return id;
};

// Mark as 'syncing' BEFORE the API call.
// If the app crashes between this write and markSynced(), resetSyncingOrders()
// on next startup resets the row to 'pending', enabling a safe retry.
export const markSyncing = (id: string): void => {
  db.runSync(`UPDATE order_queue SET status = 'syncing' WHERE id = ?`, [id]);
};

export const markSynced = (id: string): void => {
  db.runSync(
    `UPDATE order_queue SET status = 'synced', synced_at = ?, error = NULL WHERE id = ?`,
    [new Date().toISOString(), id],
  );
};

export const markFailed = (id: string, error: string, retries: number): void => {
  const next      = nextAttemptTime(retries);
  const newStatus: QueueStatus = retries >= 5 ? 'failed' : 'pending';
  db.runSync(
    `UPDATE order_queue SET status = ?, retries = ?, next_attempt = ?, error = ? WHERE id = ?`,
    [newStatus, retries + 1, next, error, id],
  );
};

export const removeOrder = (id: string): void => {
  db.runSync('DELETE FROM order_queue WHERE id = ?', [id]);
};

// ── Crash recovery ────────────────────────────────────────────────────────────

// Called on every startSyncEngine(). Any row left in 'syncing' means the
// previous session crashed mid-sync. Reset to 'pending' so they retry.
// Server-side idempotency (offlineId unique index) prevents duplicate orders.
export const resetSyncingOrders = (): void => {
  db.runSync(
    `UPDATE order_queue SET status = 'pending', next_attempt = ? WHERE status = 'syncing'`,
    [new Date().toISOString()],
  );
};

// ── Maintenance ───────────────────────────────────────────────────────────────

// Delete successfully synced rows older than daysToKeep. Prevents unbounded
// table growth at 1000+ orders/day. Returns number of rows deleted.
export const pruneOldSyncedOrders = (daysToKeep = 7): number => {
  const cutoff = new Date(Date.now() - daysToKeep * 86_400_000).toISOString();
  const result = db.runSync(
    `DELETE FROM order_queue WHERE status = 'synced' AND synced_at < ?`,
    [cutoff],
  );
  return result.changes;
};

// ── Read ──────────────────────────────────────────────────────────────────────

export const getPendingOrders = (): QueuedOrder[] => {
  const now  = new Date().toISOString();
  const rows = db.getAllSync<RawRow>(
    `SELECT * FROM order_queue
     WHERE status = 'pending' AND (next_attempt IS NULL OR next_attempt <= ?)
     ORDER BY created_at ASC`,
    [now],
  );
  return rows.map(parseRow).filter((r): r is QueuedOrder => r !== null);
};

export const getAllQueuedOrders = (): QueuedOrder[] => {
  const rows = db.getAllSync<RawRow>(
    'SELECT * FROM order_queue ORDER BY created_at DESC',
  );
  return rows.map(parseRow).filter((r): r is QueuedOrder => r !== null);
};

export const getPendingCount = (): number => {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) as n FROM order_queue WHERE status IN ('pending', 'syncing')`,
  );
  return row?.n ?? 0;
};

export const getFailedCount = (): number => {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) as n FROM order_queue WHERE status = 'failed'`,
  );
  return row?.n ?? 0;
};

export const resetFailedOrders = (): void => {
  db.runSync(
    `UPDATE order_queue SET status = 'pending', retries = 0, next_attempt = ? WHERE status = 'failed'`,
    [new Date().toISOString()],
  );
};
