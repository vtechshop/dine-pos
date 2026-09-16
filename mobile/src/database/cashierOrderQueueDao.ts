import { db } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CashierQueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface AfterCreate {
  markServed: boolean;
  complete: boolean;
}

export interface QueuedCashierOrder {
  id: number;
  offlineId: string;
  hotelId: string;
  payload: object;
  afterCreate: AfterCreate;
  status: CashierQueueStatus;
  retryCount: number;
  createdAt: string;
  nextAttemptAt: number | null;
  serverId: string | null;
  serverOrderNumber: string | null;
  syncedAt: string | null;
  lastError: string | null;
  errorCode: string | null;
}

// Client-computed totals must not be trusted — the server recalculates from items.
const STRIP_FIELDS: ReadonlyArray<string> = ['grandTotal', 'subtotal', 'taxTotal', 'stock'];

// Backoff schedule: 5s → 15s → 45s → 2m → 5m (capped). Matches web engine.
export const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export function backoffDelayMs(attempt: number): number {
  const i = Math.min(Math.max(Math.trunc(attempt), 1), BACKOFF_SCHEDULE_MS.length) - 1;
  return BACKOFF_SCHEDULE_MS[i];
}

// ── Row parsing ───────────────────────────────────────────────────────────────

type RawRow = {
  id: number;
  offline_id: string;
  hotel_id: string;
  payload: string;
  after_create: string;
  status: string;
  created_at: string;
  retry_count: number;
  next_attempt_at: number | null;
  server_id: string | null;
  server_order_number: string | null;
  synced_at: string | null;
  last_error: string | null;
  error_code: string | null;
};

const parseRow = (r: RawRow): QueuedCashierOrder | null => {
  try {
    return {
      id: r.id,
      offlineId: r.offline_id,
      hotelId: r.hotel_id,
      payload: JSON.parse(r.payload),
      afterCreate: JSON.parse(r.after_create ?? '{"markServed":true,"complete":true}'),
      status: r.status as CashierQueueStatus,
      retryCount: r.retry_count,
      createdAt: r.created_at,
      nextAttemptAt: r.next_attempt_at,
      serverId: r.server_id,
      serverOrderNumber: r.server_order_number,
      syncedAt: r.synced_at,
      lastError: r.last_error,
      errorCode: r.error_code,
    };
  } catch {
    // Permanently fail corrupt rows so they can never block the queue again.
    db.runSync(
      `UPDATE cashier_order_queue SET status='failed', last_error='Corrupt payload JSON', retry_count=99 WHERE offline_id=?`,
      [r.offline_id],
    );
    return null;
  }
};

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Enqueue a cashier order for later sync. Strips client-computed totals
 * so the server recalculates them authoritatively.
 * afterCreate.markServed + complete default to true for cash/card payments
 * (the cashier collected payment; order is complete immediately on sync).
 */
export const enqueueOrder = (
  hotelId: string,
  offlineId: string,
  payload: object,
  afterCreate: AfterCreate = { markServed: true, complete: true },
): void => {
  const safe = { ...(payload as Record<string, unknown>) };
  for (const field of STRIP_FIELDS) delete safe[field];

  db.runSync(
    `INSERT OR IGNORE INTO cashier_order_queue
       (offline_id, hotel_id, payload, after_create, status, created_at, retry_count)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), 0)`,
    [offlineId, hotelId, JSON.stringify(safe), JSON.stringify(afterCreate)],
  );
};

// ── State transitions ─────────────────────────────────────────────────────────

/** Claim the next eligible pending order in FIFO order. Returns null if none ready. */
export const nextQueued = (hotelId: string, now: number): QueuedCashierOrder | null => {
  const row = db.getFirstSync<RawRow>(
    `SELECT * FROM cashier_order_queue
     WHERE hotel_id = ? AND status = 'pending'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC
     LIMIT 1`,
    [hotelId, now],
  );
  return row ? parseRow(row) : null;
};

/** Atomically set status to 'syncing'. Returns false if the row was already claimed. */
export const claimForSync = (hotelId: string, offlineId: string): boolean => {
  const result = db.runSync(
    `UPDATE cashier_order_queue SET status = 'syncing'
     WHERE hotel_id = ? AND offline_id = ? AND status = 'pending'`,
    [hotelId, offlineId],
  );
  return result.changes > 0;
};

export const markSynced = (
  hotelId: string,
  offlineId: string,
  serverId: string,
  serverOrderNumber: string | null,
): void => {
  db.runSync(
    `UPDATE cashier_order_queue
     SET status = 'synced', server_id = ?, server_order_number = ?,
         synced_at = datetime('now'), last_error = NULL, error_code = NULL
     WHERE hotel_id = ? AND offline_id = ?`,
    [serverId, serverOrderNumber ?? null, hotelId, offlineId],
  );
};

/**
 * Back off a failed attempt. On reaching MAX_RETRIES the order transitions to
 * 'failed' (permanent, requires manual retry).
 */
export const MAX_RETRIES = 5;

export const markRetry = (
  hotelId: string,
  offlineId: string,
  error: string,
  errorCode: string,
  nextAttemptAt: number,
): void => {
  const row = db.getFirstSync<{ retry_count: number }>(
    `SELECT retry_count FROM cashier_order_queue WHERE hotel_id = ? AND offline_id = ?`,
    [hotelId, offlineId],
  );
  const retryCount = (row?.retry_count ?? 0) + 1;
  const newStatus: CashierQueueStatus = retryCount >= MAX_RETRIES ? 'failed' : 'pending';

  db.runSync(
    `UPDATE cashier_order_queue
     SET status = ?, retry_count = ?, next_attempt_at = ?, last_error = ?, error_code = ?
     WHERE hotel_id = ? AND offline_id = ?`,
    [newStatus, retryCount, nextAttemptAt, error, errorCode, hotelId, offlineId],
  );
};

export const markFailed = (
  hotelId: string,
  offlineId: string,
  error: string,
  errorCode: string,
): void => {
  db.runSync(
    `UPDATE cashier_order_queue
     SET status = 'failed', last_error = ?, error_code = ?
     WHERE hotel_id = ? AND offline_id = ?`,
    [error, errorCode, hotelId, offlineId],
  );
};

// ── Crash recovery ────────────────────────────────────────────────────────────

/**
 * Any row left in 'syncing' by a previous session means the app died mid-sync.
 * Reset to 'pending' so they retry. The server's offlineId unique index prevents
 * duplicates if the request actually completed before the crash.
 */
export const resetStaleSyncing = (hotelId: string): void => {
  db.runSync(
    `UPDATE cashier_order_queue SET status = 'pending', next_attempt_at = NULL
     WHERE hotel_id = ? AND status = 'syncing'`,
    [hotelId],
  );
};

// ── Read ──────────────────────────────────────────────────────────────────────

export const getPendingCount = (hotelId: string): number => {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) as n FROM cashier_order_queue
     WHERE hotel_id = ? AND status IN ('pending', 'syncing')`,
    [hotelId],
  );
  return row?.n ?? 0;
};

export const getFailedCount = (hotelId: string): number => {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) as n FROM cashier_order_queue WHERE hotel_id = ? AND status = 'failed'`,
    [hotelId],
  );
  return row?.n ?? 0;
};

export const getFailedOrders = (hotelId: string): QueuedCashierOrder[] => {
  const rows = db.getAllSync<RawRow>(
    `SELECT * FROM cashier_order_queue WHERE hotel_id = ? AND status = 'failed' ORDER BY created_at ASC`,
    [hotelId],
  );
  return rows.map(parseRow).filter((r): r is QueuedCashierOrder => r !== null);
};

export const resetFailedOrders = (hotelId: string): void => {
  db.runSync(
    `UPDATE cashier_order_queue
     SET status = 'pending', retry_count = 0, next_attempt_at = NULL, last_error = NULL, error_code = NULL
     WHERE hotel_id = ? AND status = 'failed'`,
    [hotelId],
  );
};

/** Remove successfully synced rows older than daysToKeep. */
export const pruneSynced = (hotelId: string, daysToKeep = 7): number => {
  const cutoff = new Date(Date.now() - daysToKeep * 86_400_000).toISOString();
  const result = db.runSync(
    `DELETE FROM cashier_order_queue
     WHERE hotel_id = ? AND status = 'synced' AND synced_at < ?`,
    [hotelId, cutoff],
  );
  return result.changes;
};

// ── Legacy compat (used by SyncContext failedCount/pendingCount before hotel is known) ──

/** Total pending across all hotels — for pre-auth banner. */
export const getCashierQueueCount = (): number => {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) as n FROM cashier_order_queue WHERE status IN ('pending', 'syncing')`,
  );
  return row?.n ?? 0;
};
