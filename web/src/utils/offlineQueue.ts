// Offline order queue — localStorage-backed, max 50 entries

export interface OfflineOrder {
  id: string;          // client-generated UUID (crypto.randomUUID or Date.now)
  payload: unknown;    // the createOrder payload
  queuedAt: string;    // ISO timestamp
  retries: number;
}

const KEY_PREFIX = 'pos_offline_queue_';

function key(hotelId: string): string {
  return `${KEY_PREFIX}${hotelId}`;
}

export function getQueue(hotelId: string): OfflineOrder[] {
  if (!hotelId) return [];
  try {
    return JSON.parse(localStorage.getItem(key(hotelId)) ?? '[]') as OfflineOrder[];
  } catch { return []; }
}

export function enqueueOrder(hotelId: string, payload: unknown): OfflineOrder {
  const entry: OfflineOrder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    queuedAt: new Date().toISOString(),
    retries: 0,
  };
  const current = getQueue(hotelId).slice(0, 49); // cap at 50
  localStorage.setItem(key(hotelId), JSON.stringify([entry, ...current]));
  return entry;
}

export function removeFromQueue(hotelId: string, entryId: string): void {
  const updated = getQueue(hotelId).filter(e => e.id !== entryId);
  localStorage.setItem(key(hotelId), JSON.stringify(updated));
}

export function clearQueue(hotelId: string): void {
  localStorage.removeItem(key(hotelId));
}
