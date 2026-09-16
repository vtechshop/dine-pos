// Offline order queue — IndexedDB-backed (Sprint 2).
//
// IndexedDB is the ONE authoritative offline order queue. The old localStorage queue
// (`pos_offline_queue_<hotelId>`) is migrated once by `migrateLegacyQueue` and then removed.
//
// Every record is hotel-scoped: every read filters on hotelId, and every state change checks
// that the record belongs to the hotel asking. Nothing here talks to the network — the sync
// engine (`src/sync/syncEngine.ts`) does that.

import {
  getDb,
  type PendingOrderAfterCreate,
  type PendingOrderRecord,
  type PendingOrderSyncStatus,
} from '../db/offlineDb';
import type { CreateOrderPayload } from '../api/orders';

export type { PendingOrderAfterCreate, PendingOrderRecord, PendingOrderSyncStatus };

/** Shape of an entry in the pre-Sprint-2 localStorage queue. */
export interface OfflineOrder {
  id: string;
  payload: unknown;
  queuedAt: string;
  retries: number;
}

export const LEGACY_QUEUE_KEY_PREFIX = 'pos_offline_queue_';

/**
 * Payment methods the cashier records by hand. These are the only ones the POS order form
 * offers, and none of them involves a payment gateway, so a bill can be saved offline.
 */
export const OFFLINE_PAYMENT_METHODS = ['cash', 'upi', 'card', 'split'] as const;

/** Order sources that exist only with a live connection (customer self-ordering, aggregators). */
const ONLINE_ONLY_SOURCES = new Set(['qr', 'kiosk', 'swiggy', 'zomato']);

/** Fields that belong to a gateway payment. Their presence means the bill cannot be queued. */
const ONLINE_PAYMENT_FIELDS = [
  'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature',
  'paymentLinkId', 'transactionId', 'upiApp', 'walletAmount', 'useWallet',
];

/** Client-side figures the server must never be sent: it calculates them itself. */
const CLIENT_TOTAL_FIELDS = ['subtotal', 'taxTotal', 'grandTotal', 'total', 'stock', 'stockUpdates'];

/** A `syncing` record older than this, with no lock to prove otherwise, is an interrupted attempt. */
export const STALE_SYNCING_MS = 60_000;

/** Synced records are kept this long so "Last synced" and support questions have an answer. */
export const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class OfflineQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineQueueError';
  }
}

// ── Change notifications ─────────────────────────────────────────────────────

const listeners = new Set<() => void>();

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyQueueChanged(): void {
  listeners.forEach(listener => {
    try { listener(); } catch { /* a broken listener must not break the queue */ }
  });
}

// ── Ids and guards ───────────────────────────────────────────────────────────

/** RFC 4122 v4 id. `getRandomValues` works on plain-http LAN terminals where `randomUUID` does not. */
export function newOfflineId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new OfflineQueueError('This browser cannot create a secure bill id, so the bill cannot be saved offline.');
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Refuses anything that must never be saved offline: an empty bill, a QR/kiosk/aggregator order,
 * or any gateway payment (Razorpay, online UPI, wallet).
 */
export function assertOfflineQueueable(payload: unknown): asserts payload is CreateOrderPayload {
  const order = payload as Partial<CreateOrderPayload> & Record<string, unknown> | null;
  if (!order || typeof order !== 'object' || !Array.isArray(order.items) || order.items.length === 0) {
    throw new OfflineQueueError('A bill with no items cannot be saved offline.');
  }
  if (typeof order.orderSource === 'string' && ONLINE_ONLY_SOURCES.has(order.orderSource)) {
    throw new OfflineQueueError('QR, kiosk and delivery-app orders need an internet connection.');
  }
  const method = order.paymentMethod as string | undefined;
  if (method !== undefined && !(OFFLINE_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new OfflineQueueError('Online payments cannot be taken offline. Use cash or reconnect.');
  }
  if (ONLINE_PAYMENT_FIELDS.some(field => field in order)) {
    throw new OfflineQueueError('Online payments cannot be taken offline. Use cash or reconnect.');
  }
  if (((order as CreateOrderPayload).redeemedPoints ?? 0) > 0) {
    throw new OfflineQueueError('Loyalty redemption requires an internet connection.');
  }
}

/**
 * The steps NewOrderPanel runs online after `createOrder`: takeaway and delivery (sent as
 * orderSource 'admin') are marked served and completed; a dine-in order stays open for its table.
 */
export function afterCreateFor(orderSource: string | undefined): PendingOrderAfterCreate {
  if (orderSource === 'takeaway' || orderSource === 'admin') return { markServed: true, complete: true };
  return { markServed: false, complete: false };
}

function withoutClientTotals(payload: CreateOrderPayload): CreateOrderPayload {
  const copy = { ...payload } as Record<string, unknown>;
  for (const field of CLIENT_TOTAL_FIELDS) delete copy[field];
  return copy as unknown as CreateOrderPayload;
}

const fifoRange = (hotelId: string) => IDBKeyRange.bound([hotelId, -Infinity], [hotelId, Infinity]);

// ── Enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueOptions {
  /** Reuse the id the online attempt already sent, so a lost response cannot duplicate the bill. */
  offlineId?: string;
  afterCreate?: PendingOrderAfterCreate;
  now?: number;
}

export async function enqueueOrder(
  hotelId: string,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<PendingOrderRecord> {
  if (!hotelId) throw new OfflineQueueError('Sign in to a hotel before saving a bill offline.');
  assertOfflineQueueable(payload);

  const offlineId = options.offlineId ?? payload.offlineId ?? newOfflineId();
  if (typeof offlineId !== 'string' || offlineId.trim().length < 8) {
    throw new OfflineQueueError('A saved bill must have a valid offline id.');
  }
  const now = options.now ?? Date.now();

  const db = await getDb();
  const tx = db.transaction('pendingOrders', 'readwrite');
  const existing = await tx.store.get(offlineId);
  if (existing) {
    await tx.done;
    if (existing.hotelId !== hotelId) {
      throw new OfflineQueueError('This bill id already belongs to another hotel.');
    }
    // Enqueueing the same bill twice (a double click) keeps ONE record.
    return existing;
  }

  const last = await tx.store.index('by-hotel-seq').openCursor(fifoRange(hotelId), 'prev');
  const queuedSeq = Math.max(now, (last?.value.queuedSeq ?? 0) + 1);

  const record: PendingOrderRecord = {
    offlineId,
    hotelId,
    payload: { ...withoutClientTotals(payload), offlineId },
    afterCreate: options.afterCreate ?? afterCreateFor(payload.orderSource),
    queuedAt: new Date(now).toISOString(),
    queuedSeq,
    syncStatus: 'queued',
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    errorReason: null,
    errorCode: null,
    serverId: null,
    serverOrderNumber: null,
    syncedAt: null,
  };
  try {
    await tx.store.add(record);
    await tx.done;
  } catch (err) {
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    throw new OfflineQueueError(
      isQuota
        ? 'Device storage is full. Clear browsing data to save offline bills.'
        : 'Could not save the bill offline. Please try again.',
    );
  }
  notifyQueueChanged();
  return record;
}

// ── Reads (always hotel-scoped, always FIFO) ─────────────────────────────────

export async function getAllOrders(hotelId: string): Promise<PendingOrderRecord[]> {
  if (!hotelId) return [];
  const db = await getDb();
  return db.getAllFromIndex('pendingOrders', 'by-hotel-seq', fifoRange(hotelId));
}

/** Orders not yet confirmed by the server: queued, syncing and sync_failed. */
export async function getQueue(hotelId: string): Promise<PendingOrderRecord[]> {
  return (await getAllOrders(hotelId)).filter(r => r.syncStatus !== 'synced');
}

export async function getPendingCount(hotelId: string): Promise<number> {
  return (await getAllOrders(hotelId)).filter(r => r.syncStatus === 'queued' || r.syncStatus === 'syncing').length;
}

export async function getFailedCount(hotelId: string): Promise<number> {
  return (await getAllOrders(hotelId)).filter(r => r.syncStatus === 'sync_failed').length;
}

export async function nextQueued(hotelId: string): Promise<PendingOrderRecord | null> {
  return (await getAllOrders(hotelId)).find(r => r.syncStatus === 'queued') ?? null;
}

/** When the next automatic attempt is due, or null when nothing is waiting. */
export async function nextWakeAt(hotelId: string, now: number): Promise<number | null> {
  const due = (await getAllOrders(hotelId))
    .filter(r => r.syncStatus === 'queued')
    .map(r => r.nextAttemptAt ?? now);
  return due.length ? Math.min(...due) : null;
}

export interface QueueOrderView {
  offlineId: string;
  queuedAt: string;
  label: string;
  itemCount: number;
  reason: string | null;
  /** True when the order exists on the server but a later step (closing the bill) failed. */
  savedOnServer: boolean;
}

export interface QueueSummary {
  pending: number;
  syncing: number;
  failed: number;
  synced: number;
  oldestQueuedAt: string | null;
  lastSyncedAt: string | null;
  loginRequired: boolean;
  failedOrders: QueueOrderView[];
  waitingOrders: QueueOrderView[];
}

function viewOf(record: PendingOrderRecord): QueueOrderView {
  const p = record.payload;
  const label = p.customerName?.trim()
    || (p.orderSource === 'dine-in' && p.tableNumber ? `Table ${p.tableNumber}` : 'Walk-in bill');
  return {
    offlineId: record.offlineId,
    queuedAt: record.queuedAt,
    label,
    itemCount: Array.isArray(p.items) ? p.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) : 0,
    reason: record.errorReason,
    savedOnServer: record.serverId !== null,
  };
}

export async function getQueueSummary(hotelId: string): Promise<QueueSummary> {
  const records = await getAllOrders(hotelId);
  const waiting = records.filter(r => r.syncStatus === 'queued' || r.syncStatus === 'syncing');
  const failed = records.filter(r => r.syncStatus === 'sync_failed');
  const synced = records.filter(r => r.syncStatus === 'synced' && r.syncedAt);
  const unsynced = [...waiting, ...failed].sort((a, b) => a.queuedSeq - b.queuedSeq);
  return {
    pending: waiting.length,
    syncing: records.filter(r => r.syncStatus === 'syncing').length,
    failed: failed.length,
    synced: synced.length,
    oldestQueuedAt: unsynced[0]?.queuedAt ?? null,
    lastSyncedAt: synced.map(r => r.syncedAt as string).sort().pop() ?? null,
    loginRequired: waiting.some(r => r.errorCode === 'auth_required' || r.errorCode === 'subscription_expired'),
    failedOrders: failed.map(viewOf),
    waitingOrders: waiting.map(viewOf),
  };
}

// ── State transitions (each one checks hotel and current state) ─────────────

async function transition(
  hotelId: string,
  offlineId: string,
  from: PendingOrderSyncStatus[],
  apply: (record: PendingOrderRecord) => PendingOrderRecord,
): Promise<PendingOrderRecord | null> {
  if (!hotelId || !offlineId) return null;
  const db = await getDb();
  const tx = db.transaction('pendingOrders', 'readwrite');
  const current = await tx.store.get(offlineId);
  if (!current || current.hotelId !== hotelId || !from.includes(current.syncStatus)) {
    await tx.done;
    return null;
  }
  const next = apply(current);
  await tx.store.put(next);
  await tx.done;
  notifyQueueChanged();
  return next;
}

export interface SyncErrorInfo {
  code: string;
  reason: string;
}

/** queued → syncing. Returns null when the record is not (or no longer) queued for this hotel. */
export function claimForSync(hotelId: string, offlineId: string, now: number) {
  return transition(hotelId, offlineId, ['queued'], r => ({
    ...r,
    syncStatus: 'syncing',
    lastAttemptAt: new Date(now).toISOString(),
  }));
}

/** syncing → synced, only after the server confirmed the order. */
export function markSynced(
  hotelId: string,
  offlineId: string,
  server: { id: string; orderNumber: string | null },
  now: number,
) {
  return transition(hotelId, offlineId, ['syncing'], r => ({
    ...r,
    syncStatus: 'synced',
    serverId: server.id,
    serverOrderNumber: server.orderNumber,
    syncedAt: new Date(now).toISOString(),
    nextAttemptAt: null,
    errorReason: null,
    errorCode: null,
  }));
}

/** syncing → queued, with the retry counted and the next attempt pushed back. */
export function markRetry(
  hotelId: string,
  offlineId: string,
  error: SyncErrorInfo,
  nextAttemptAt: number,
  serverId: string | null = null,
) {
  return transition(hotelId, offlineId, ['syncing'], r => ({
    ...r,
    syncStatus: 'queued',
    retryCount: r.retryCount + 1,
    nextAttemptAt,
    errorReason: error.reason,
    errorCode: error.code,
    serverId: serverId ?? r.serverId,
  }));
}

/** syncing → sync_failed. The record is kept; nothing is ever silently deleted. */
export function markFailed(
  hotelId: string,
  offlineId: string,
  error: SyncErrorInfo,
  serverId: string | null = null,
) {
  return transition(hotelId, offlineId, ['syncing'], r => ({
    ...r,
    syncStatus: 'sync_failed',
    nextAttemptAt: null,
    errorReason: error.reason,
    errorCode: error.code,
    serverId: serverId ?? r.serverId,
  }));
}

/** sync_failed → queued, when a person asks for another try. The offlineId never changes. */
export function requeueFailed(hotelId: string, offlineId: string) {
  return transition(hotelId, offlineId, ['sync_failed'], r => ({
    ...r,
    syncStatus: 'queued',
    retryCount: 0,
    nextAttemptAt: null,
    errorReason: null,
    errorCode: null,
  }));
}

/**
 * syncing → queued for attempts a crash or a closed tab left behind. The retry is safe: it
 * carries the same offlineId, so an order that did reach the server is returned, not recreated.
 */
export async function recoverStaleSyncing(hotelId: string, now: number, staleAfterMs: number): Promise<number> {
  if (!hotelId) return 0;
  const db = await getDb();
  const tx = db.transaction('pendingOrders', 'readwrite');
  const records = await tx.store.index('by-hotel-seq').getAll(fifoRange(hotelId));
  let recovered = 0;
  for (const r of records) {
    if (r.syncStatus !== 'syncing') continue;
    const attemptedAt = r.lastAttemptAt ? new Date(r.lastAttemptAt).getTime() : 0;
    if (now - attemptedAt < staleAfterMs) continue;
    await tx.store.put({
      ...r,
      syncStatus: 'queued',
      nextAttemptAt: null,
      errorCode: 'interrupted',
      errorReason: 'Sending was interrupted. It will be retried.',
    });
    recovered += 1;
  }
  await tx.done;
  if (recovered) notifyQueueChanged();
  return recovered;
}

/** Removes synced records older than the retention window. Never touches an unsynced bill. */
export async function pruneSynced(hotelId: string, now: number, olderThanMs = SYNCED_RETENTION_MS): Promise<number> {
  if (!hotelId) return 0;
  const db = await getDb();
  const tx = db.transaction('pendingOrders', 'readwrite');
  const records = await tx.store.index('by-hotel-seq').getAll(fifoRange(hotelId));
  let removed = 0;
  for (const r of records) {
    if (r.syncStatus === 'synced' && r.syncedAt && now - new Date(r.syncedAt).getTime() > olderThanMs) {
      await tx.store.delete(r.offlineId);
      removed += 1;
    }
  }
  await tx.done;
  return removed;
}

/** Deletes one record of this hotel. Only for an explicit person action. */
export async function removeFromQueue(hotelId: string, offlineId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('pendingOrders', 'readwrite');
  const current = await tx.store.get(offlineId);
  if (current && current.hotelId === hotelId) await tx.store.delete(offlineId);
  await tx.done;
  notifyQueueChanged();
}

/** Clears this hotel's SYNCED history. Unsynced bills are never cleared. */
export async function clearQueue(hotelId: string): Promise<void> {
  await pruneSynced(hotelId, Date.now(), -1);
  notifyQueueChanged();
}

// ── One-time migration from the localStorage queue ───────────────────────────

export interface LegacyMigrationResult {
  migrated: number;
  unreadable: number;
  keysRemoved: string[];
  keysKept: string[];
}

function legacyRecords(hotelId: string, entries: unknown[], now: number): PendingOrderRecord[] {
  // The old queue stored newest first; the new one sends oldest first.
  const parsed = entries
    .filter((e): e is Partial<OfflineOrder> => !!e && typeof e === 'object')
    .map(e => {
      const time = typeof e.queuedAt === 'string' ? new Date(e.queuedAt).getTime() : NaN;
      return { entry: e, time: Number.isFinite(time) ? time : now };
    })
    .sort((a, b) => a.time - b.time);

  let seq = 0;
  return parsed.map(({ entry, time }) => {
    seq = Math.max(time, seq + 1);
    let readable = true;
    try { assertOfflineQueueable(entry.payload); } catch { readable = false; }
    const payload = (entry.payload ?? {}) as CreateOrderPayload;
    // The old sync already sent `entry.id` as the offlineId, so keeping it is what makes a
    // migrated bill safe to resend.
    const offlineId = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : newOfflineId();
    return {
      offlineId,
      hotelId,
      payload: readable ? { ...withoutClientTotals(payload), offlineId } : payload,
      afterCreate: afterCreateFor(readable ? payload.orderSource : undefined),
      queuedAt: new Date(time).toISOString(),
      queuedSeq: seq,
      syncStatus: readable ? 'queued' : 'sync_failed',
      retryCount: typeof entry.retries === 'number' ? entry.retries : 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      errorReason: readable ? null : 'This bill was saved by an older version and cannot be sent automatically.',
      errorCode: readable ? null : 'legacy_unreadable',
      serverId: null,
      serverOrderNumber: null,
      syncedAt: null,
    } satisfies PendingOrderRecord;
  });
}

/**
 * Moves every `pos_offline_queue_<hotelId>` entry into IndexedDB, then removes that key — and
 * only then. A key that cannot be parsed or written is left exactly as it was, so a failed
 * migration loses nothing and is retried on the next start.
 */
export async function migrateLegacyQueue(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
  now = Date.now(),
): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { migrated: 0, unreadable: 0, keysRemoved: [], keysKept: [] };
  if (!storage) return result;

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(LEGACY_QUEUE_KEY_PREFIX)) keys.push(key);
  }

  for (const key of keys) {
    const hotelId = key.slice(LEGACY_QUEUE_KEY_PREFIX.length);
    let entries: unknown;
    try {
      entries = JSON.parse(storage.getItem(key) ?? '[]');
    } catch {
      result.keysKept.push(key);
      continue;
    }
    if (!hotelId || !Array.isArray(entries)) {
      result.keysKept.push(key);
      continue;
    }

    const records = legacyRecords(hotelId, entries, now);
    try {
      const db = await getDb();
      const tx = db.transaction('pendingOrders', 'readwrite');
      for (const record of records) {
        const existing = await tx.store.get(record.offlineId);
        if (!existing) await tx.store.add(record);
      }
      await tx.done;
    } catch {
      result.keysKept.push(key);
      continue;
    }

    storage.removeItem(key);
    result.keysRemoved.push(key);
    result.migrated += records.length;
    result.unreadable += records.filter(r => r.syncStatus === 'sync_failed').length;
  }

  if (result.migrated) notifyQueueChanged();
  return result;
}
