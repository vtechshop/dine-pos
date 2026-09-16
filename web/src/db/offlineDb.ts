import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Product, Category } from '../types';
import type { CreateOrderPayload } from '../api/orders';

export interface CachedProduct extends Product { hotelId: string }
export interface CachedCategory extends Category { hotelId: string }

interface CartRecord {
  hotelId: string;
  items: unknown[];
  savedAt: string;
}

interface SyncMetaRecord {
  key: string;
  hotelId: string;
  syncedAt: string;
}

// ── Offline order queue (Sprint 2) ────────────────────────────────────────────

export type PendingOrderSyncStatus = 'queued' | 'syncing' | 'synced' | 'sync_failed';

/**
 * What the cashier screen does after the order exists on the server. Recorded at queue time
 * so a bill replays exactly the steps it would have run online.
 */
export interface PendingOrderAfterCreate {
  markServed: boolean;
  complete: boolean;
}

export interface PendingOrderRecord {
  /** Stable client id. Sent on EVERY attempt; the server returns the existing order for a repeat. */
  offlineId: string;
  hotelId: string;
  payload: CreateOrderPayload;
  afterCreate: PendingOrderAfterCreate;
  queuedAt: string;
  /** FIFO position within the hotel. Strictly increasing per hotel. */
  queuedSeq: number;
  syncStatus: PendingOrderSyncStatus;
  retryCount: number;
  lastAttemptAt: string | null;
  /** Epoch ms before which an automatic sync will not retry. Null = due now. */
  nextAttemptAt: number | null;
  errorReason: string | null;
  errorCode: string | null;
  serverId: string | null;
  serverOrderNumber: string | null;
  syncedAt: string | null;
}

interface PosDBSchema extends DBSchema {
  products: {
    key: string;
    value: CachedProduct;
    indexes: { 'by-hotel': string };
  };
  categories: {
    key: string;
    value: CachedCategory;
    indexes: { 'by-hotel': string };
  };
  cart: {
    key: string;
    value: CartRecord;
  };
  syncMeta: {
    key: string;
    value: SyncMetaRecord;
  };
  pendingOrders: {
    key: string;
    value: PendingOrderRecord;
    indexes: {
      'by-hotel': string;
      'by-hotel-seq': [string, number];
    };
  };
}

export type PosDB = IDBPDatabase<PosDBSchema>;

export const OFFLINE_DB_NAME = 'dinepos-offline';
/** v1 = Sprint 1 caches; v2 = Sprint 2 pendingOrders. */
export const OFFLINE_DB_VERSION = 2;

let dbPromise: Promise<PosDB> | null = null;

export function getDb(): Promise<PosDB> {
  if (!dbPromise) {
    dbPromise = openDB<PosDBSchema>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
      upgrade(db, oldVersion) {
        // Each block runs once per device, in order. A device already on v1 keeps its
        // cached products, categories and cart and only gains the pending order store.
        if (oldVersion < 1) {
          const productStore = db.createObjectStore('products', { keyPath: '_id' });
          productStore.createIndex('by-hotel', 'hotelId');

          const categoryStore = db.createObjectStore('categories', { keyPath: '_id' });
          categoryStore.createIndex('by-hotel', 'hotelId');

          db.createObjectStore('cart', { keyPath: 'hotelId' });
          db.createObjectStore('syncMeta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          const pending = db.createObjectStore('pendingOrders', { keyPath: 'offlineId' });
          pending.createIndex('by-hotel', 'hotelId');
          pending.createIndex('by-hotel-seq', ['hotelId', 'queuedSeq']);
        }
      },
    }).then(db => {
      // Another tab opening a newer version must not be blocked by this one.
      db.addEventListener('versionchange', () => {
        db.close();
        dbPromise = null;
      });
      return db;
    });
  }
  return dbPromise;
}

export function resetDbForTesting(): void {
  dbPromise = null;
}
