import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@hotel_pos_offline_queue';

export interface QueuedOrder {
  id: string;
  payload: object;
  createdAt: string;
  retries: number;
}

export const enqueueOrder = async (payload: object): Promise<string> => {
  const id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const item: QueuedOrder = { id, payload, createdAt: new Date().toISOString(), retries: 0 };
  const existing = await getQueue();
  existing.push(item);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(existing));
  return id;
};

export const getQueue = async (): Promise<QueuedOrder[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export const removeFromQueue = async (id: string): Promise<void> => {
  const existing = await getQueue();
  const filtered = existing.filter(i => i.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
};

export const incrementRetry = async (id: string): Promise<void> => {
  const existing = await getQueue();
  const updated = existing.map(i => i.id === id ? { ...i, retries: i.retries + 1 } : i);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
};

export const clearQueue = async (): Promise<void> => {
  await AsyncStorage.removeItem(QUEUE_KEY);
};

// Flush queued orders when network comes back
export const flushQueue = async (
  createOrderFn: (payload: object) => Promise<any>,
  onSync?: (synced: number, failed: number) => void
): Promise<void> => {
  const queue = await getQueue();
  if (queue.length === 0) return;

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.retries >= 3) { failed++; await removeFromQueue(item.id); continue; }
    try {
      await createOrderFn(item.payload);
      await removeFromQueue(item.id);
      synced++;
    } catch {
      await incrementRetry(item.id);
      failed++;
    }
  }

  onSync?.(synced, failed);
};
