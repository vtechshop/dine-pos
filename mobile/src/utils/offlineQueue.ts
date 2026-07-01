/**
 * Legacy offline queue — now backed by SQLite via orderQueueDao.
 * AsyncStorage-based implementation has been replaced.
 * This file is kept for import compatibility; new code should use
 * orderQueueDao or SyncContext directly.
 */
import { enqueueOrder as sqliteEnqueue } from '../database/orderQueueDao';

export interface QueuedOrder {
  id: string;
  payload: object;
  createdAt: string;
  retries: number;
}

export const enqueueOrder = async (payload: object): Promise<string> => {
  return sqliteEnqueue(payload);
};

// Deprecated — sync is handled automatically by syncEngine via SyncContext
export const flushQueue = async (
  _createOrderFn: (payload: object) => Promise<any>,
  _onSync?: (synced: number, failed: number) => void
): Promise<void> => {};

// Deprecated stubs kept for any remaining callers
export const getQueue    = async (): Promise<QueuedOrder[]> => [];
export const clearQueue  = async (): Promise<void> => {};
export const removeFromQueue = async (_id: string): Promise<void> => {};
export const incrementRetry  = async (_id: string): Promise<void> => {};
