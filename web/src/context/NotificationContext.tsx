import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react';
import { useCashier } from './CashierContext';
import { fetchPrinterDevices } from '../api/dashboard';
import { fetchCashierOrders, fetchKitchenOrders } from '../api/orders';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifCategory =
  | 'printer_offline'
  | 'kitchen_delay'
  | 'payment_pending'
  | 'shift_reminder'
  | 'drawer_alert';

export interface CashierNotif {
  id: string;             // stable key: "category:subject_id"
  category: NotifCategory;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  ts: number;
  read: boolean;
}

interface NotifCtxValue {
  notifications: CashierNotif[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const NotifCtx = createContext<NotifCtxValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { shift, drawerBalance } = useCashier();
  const [notifMap, setNotifMap] = useState<Map<string, CashierNotif>>(new Map());

  const upsert = useCallback((n: Omit<CashierNotif, 'read'> & { read?: boolean }) => {
    setNotifMap(prev => {
      const next = new Map(prev);
      const existing = next.get(n.id);
      next.set(n.id, {
        read: existing?.read ?? false,
        ...n,
      });
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setNotifMap(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const removeByPrefix = useCallback((prefix: string, keepIds: Set<string>) => {
    setNotifMap(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [key] of next) {
        if (key.startsWith(prefix) && !keepIds.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // ── Printer offline detection ─────────────────────────────────────────────
  const pollPrinters = useCallback(async () => {
    try {
      const devices = await fetchPrinterDevices();
      const nowMs = Date.now();
      const liveIds = new Set<string>();
      for (const d of devices) {
        const offline = !d.online || !d.lastHeartbeat ||
          nowMs - new Date(d.lastHeartbeat).getTime() >= 3 * 60_000;
        const id = `printer_offline:${d._id}`;
        if (offline) {
          liveIds.add(id);
          upsert({
            id,
            category: 'printer_offline',
            title: 'Printer Offline',
            message: `${d.printerName ?? 'Printer'} (${d.printerRole}) is not responding`,
            severity: 'critical',
            ts: Date.now(),
          });
        } else {
          remove(id);
        }
      }
    } catch { /* non-fatal */ }
  }, [upsert, remove]);

  // ── Kitchen delay detection ───────────────────────────────────────────────
  const pollKitchen = useCallback(async () => {
    try {
      const orders = await fetchKitchenOrders();
      const nowMs = Date.now();
      const liveIds = new Set<string>();
      for (const o of orders) {
        if (o.status === 'pending' || o.status === 'preparing') {
          const ageMin = (nowMs - new Date(o.createdAt).getTime()) / 60_000;
          if (ageMin >= 20) {
            const id = `kitchen_delay:${o._id}`;
            liveIds.add(id);
            upsert({
              id,
              category: 'kitchen_delay',
              title: 'Kitchen Delay',
              message: `Order #${o.orderNumber} – ${Math.floor(ageMin)}m in kitchen`,
              severity: ageMin >= 30 ? 'critical' : 'warning',
              ts: Date.now(),
            });
          }
        }
      }
      removeByPrefix('kitchen_delay:', liveIds);
    } catch { /* non-fatal */ }
  }, [upsert, removeByPrefix]);

  // ── Payment pending detection ─────────────────────────────────────────────
  const pollPayments = useCallback(async () => {
    try {
      const orders = await fetchCashierOrders();
      const nowMs = Date.now();
      const liveIds = new Set<string>();
      for (const o of orders) {
        if (o.status === 'served') {
          const ageMin = (nowMs - new Date(o.createdAt).getTime()) / 60_000;
          if (ageMin >= 20) {
            const id = `payment_pending:${o._id}`;
            liveIds.add(id);
            upsert({
              id,
              category: 'payment_pending',
              title: 'Payment Awaiting',
              message: `Order #${o.orderNumber} served ${Math.floor(ageMin)}m ago — collect payment`,
              severity: 'warning',
              ts: Date.now(),
            });
          }
        }
      }
      removeByPrefix('payment_pending:', liveIds);
    } catch { /* non-fatal */ }
  }, [upsert, removeByPrefix]);

  // ── Shift duration reminder ───────────────────────────────────────────────
  useEffect(() => {
    if (!shift || shift.status !== 'open') {
      remove('shift_reminder:long');
      return;
    }
    const check = () => {
      const ageH = (Date.now() - new Date(shift.openedAt).getTime()) / 3_600_000;
      if (ageH >= 7.5) {
        const h = Math.floor(ageH);
        const m = Math.floor((ageH - h) * 60);
        upsert({
          id: 'shift_reminder:long',
          category: 'shift_reminder',
          title: 'Long Shift',
          message: `Shift running ${h}h ${m}m — consider closing soon`,
          severity: 'info',
          ts: Date.now(),
        });
      } else {
        remove('shift_reminder:long');
      }
    };
    check();
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, [shift, upsert, remove]);

  // ── Negative drawer alert ─────────────────────────────────────────────────
  useEffect(() => {
    if (drawerBalance < 0) {
      upsert({
        id: 'drawer_alert:negative',
        category: 'drawer_alert',
        title: 'Drawer Alert',
        message: `Drawer balance is ₹${drawerBalance.toLocaleString('en-IN')} — below zero`,
        severity: 'critical',
        ts: Date.now(),
      });
    } else {
      remove('drawer_alert:negative');
    }
  }, [drawerBalance, upsert, remove]);

  // ── Polling intervals ─────────────────────────────────────────────────────
  useEffect(() => {
    void pollPrinters();
    const t = setInterval(() => void pollPrinters(), 60_000);
    return () => clearInterval(t);
  }, [pollPrinters]);

  useEffect(() => {
    void pollKitchen();
    void pollPayments();
    const t = setInterval(() => { void pollKitchen(); void pollPayments(); }, 30_000);
    return () => clearInterval(t);
  }, [pollKitchen, pollPayments]);

  // ── Context value ─────────────────────────────────────────────────────────
  const notifications = Array.from(notifMap.values())
    .sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      const byS = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
      return byS !== 0 ? byS : b.ts - a.ts;
    });

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback((id: string) => {
    setNotifMap(prev => {
      const n = prev.get(id);
      if (!n || n.read) return prev;
      const next = new Map(prev);
      next.set(id, { ...n, read: true });
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifMap(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [k, n] of next) {
        if (!n.read) { next.set(k, { ...n, read: true }); changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifMap(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return (
    <NotifCtx.Provider value={{ notifications, unreadCount, markRead, markAllRead, dismiss }}>
      {children}
    </NotifCtx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotifCtx);
  if (!ctx) throw new Error('useNotifications must be inside NotificationProvider');
  return ctx;
}
