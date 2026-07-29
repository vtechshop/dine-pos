import { AppState, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ToastEvent, ToastSeverity } from '../context/GlobalToastContext';

export type NotifEventType =
  | 'new_order'
  | 'new_delivery_order'
  | 'order_preparing'
  | 'order_ready'
  | 'order_served'
  | 'order_completed'
  | 'order_cancelled'
  | 'printer_error';

type Role = 'admin' | 'kitchen' | 'cashier';

interface EventCfg {
  icon: string;
  severity: ToastSeverity;
  channel: string;
  vibrate: number[];
  roles: Role[];
}

const CFG: Record<NotifEventType, EventCfg> = {
  new_order: {
    icon: 'notifications-active', severity: 'warning',
    channel: 'order_alerts_v2',  vibrate: [0, 200, 100, 300],
    roles: ['admin', 'kitchen', 'cashier'],
  },
  new_delivery_order: {
    icon: 'delivery-dining', severity: 'warning',
    channel: 'order_alerts_v2',  vibrate: [0, 200, 100, 300],
    roles: ['admin'],
  },
  order_preparing: {
    icon: 'local-fire-department', severity: 'info',
    channel: 'status_alerts_v2', vibrate: [0, 150],
    roles: ['admin', 'cashier'],
  },
  order_ready: {
    icon: 'check-circle', severity: 'success',
    channel: 'order_alerts_v2',  vibrate: [0, 300, 150, 300],
    roles: ['admin', 'cashier'],
  },
  order_served: {
    icon: 'room-service', severity: 'success',
    channel: 'status_alerts_v2', vibrate: [0, 150],
    roles: ['admin', 'cashier'],
  },
  order_completed: {
    icon: 'point-of-sale', severity: 'success',
    channel: 'status_alerts_v2', vibrate: [0, 150],
    roles: ['admin'],
  },
  order_cancelled: {
    icon: 'cancel', severity: 'error',
    channel: 'order_alerts_v2',  vibrate: [0, 400, 100, 400],
    roles: ['admin', 'kitchen', 'cashier'],
  },
  printer_error: {
    icon: 'print-disabled', severity: 'error',
    channel: 'printer_alerts_v2', vibrate: [0, 200, 100, 200, 100, 200],
    roles: ['kitchen', 'cashier'],
  },
};

const DEDUP_MS = 30_000;

class NotificationService {
  private seen = new Map<string, number>();

  private dedup(key: string): boolean {
    const exp = this.seen.get(key);
    if (exp && Date.now() < exp) return true;
    this.seen.set(key, Date.now() + DEDUP_MS);
    if (this.seen.size > 300) {
      const now = Date.now();
      for (const [k, v] of this.seen) if (v < now) this.seen.delete(k);
    }
    return false;
  }

  handle(
    type: NotifEventType,
    role: Role,
    dedupId: string,
    title: string,
    body: string,
  ): ToastEvent | null {
    if (this.dedup(`${type}:${dedupId}`)) return null;

    const cfg = CFG[type];
    if (cfg.vibrate.length) Vibration.vibrate(cfg.vibrate);

    // Always fire push notification:
    //   • In foreground: OS handler has shouldShowBanner=false so banner is suppressed,
    //     but shouldPlaySound=true fires the alert sound — the in-app toast is the popup.
    //   • In background: OS shows banner + plays sound normally.
    if (cfg.roles.includes(role)) {
      Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: cfg.channel !== 'printer_alerts_v2' ? 'order_alert.wav' : undefined,
          data: { eventType: type, role },
        },
        trigger: { channelId: cfg.channel } as Notifications.ChannelAwareTriggerInput,
      }).catch(() => {});
    }

    // Return in-app toast only when the app is visible
    if (AppState.currentState === 'active') {
      return { icon: cfg.icon, severity: cfg.severity, title, body };
    }
    return null;
  }

  // For printer errors triggered locally (not from socket), always show toast
  printerError(message: string): ToastEvent {
    const cfg = CFG['printer_error'];
    Vibration.vibrate(cfg.vibrate);
    return {
      icon: cfg.icon,
      severity: cfg.severity,
      title: 'Printer Error',
      body: message || 'Could not print. Check Bluetooth connection.',
    };
  }
}

export const NotificationSvc = new NotificationService();

export function orderLabel(tableNumber?: string, orderNumber?: string): string {
  if (tableNumber) return `Table ${tableNumber}`;
  if (orderNumber) return `Order ${orderNumber}`;
  return 'An order';
}
