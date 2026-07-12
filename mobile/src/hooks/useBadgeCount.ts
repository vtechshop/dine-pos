import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BADGE_KEYS = {
  adminOrders:    'UNREAD_ADMIN_ORDERS',
  kitchenOrders:  'UNREAD_KITCHEN_ORDERS',
  waiterReady:    'UNREAD_WAITER_READY',
  cashierPending: 'UNREAD_CASHIER_PENDING',
} as const;

// Module-level pub-sub so components sharing a key stay in sync
// without needing a context provider.
const subs  = new Map<string, Set<React.Dispatch<React.SetStateAction<number>>>>();
const cache = new Map<string, number>();

function publish(key: string, value: number) {
  cache.set(key, value);
  subs.get(key)?.forEach(fn => fn(value));
}

export function useBadgeCount(key: string) {
  const [count, setCount] = useState<number>(cache.get(key) ?? 0);

  useEffect(() => {
    if (!cache.has(key)) {
      AsyncStorage.getItem(key)
        .then(v => {
          const n = parseInt(v ?? '0', 10) || 0;
          cache.set(key, n);
          setCount(n);
        })
        .catch(() => {});
    }

    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(setCount);
    return () => { subs.get(key)?.delete(setCount); };
  }, [key]);

  const increment = useCallback(() => {
    const next = (cache.get(key) ?? 0) + 1;
    AsyncStorage.setItem(key, String(next)).catch(() => {});
    publish(key, next);
  }, [key]);

  const reset = useCallback(() => {
    AsyncStorage.setItem(key, '0').catch(() => {});
    publish(key, 0);
  }, [key]);

  return { count, increment, reset };
}

export function formatBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}
