import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Valid immediate trigger for Expo Notifications v55 (SDK 52+)
const orderTrigger = (): Notifications.TimeIntervalTriggerInput => ({
  type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
  seconds: 1,
  channelId: 'order_alerts_v2',
});

const chatTrigger = (): Notifications.TimeIntervalTriggerInput => ({
  type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
  seconds: 1,
  channelId: 'chat_alerts_v2',
});

export const setupNotifications = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
  } catch { return; }

  try {
    await Notifications.setNotificationChannelAsync('order_alerts_v2', {
      name: 'New Order Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 200, 100, 300],
      lightColor: '#E8380D',
      enableVibrate: true,
      sound: 'order_alert.wav',
    });
  } catch {}

  try {
    await Notifications.setNotificationChannelAsync('chat_alerts_v2', {
      name: 'Customer Chat',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 150, 80, 150],
      lightColor: '#E8380D',
      enableVibrate: true,
    });
  } catch {}
};

export const notifyChatMessage = async (
  tableNumber: string,
  message: string,
): Promise<void> => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `💬 Table ${tableNumber}`,
        body: message.startsWith('[Waiter Request]')
          ? message.replace('[Waiter Request] ', '🔔 ')
          : message,
        data: { type: 'chat', tableNumber },
      },
      trigger: chatTrigger(),
    });
  } catch {}
};

export const notifyNewOrder = async (
  tableNumber: string,
  grandTotal: number,
  itemCount: number,
  currency = '₹',
): Promise<void> => {
  try {
    const table = tableNumber ? `Table ${tableNumber}` : 'Walk-in';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🍽 New Order!',
        body: `${table} · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ${currency}${grandTotal.toFixed(0)}`,
        sound: 'order_alert.wav',
      },
      trigger: orderTrigger(),
    });
  } catch {}
};

// ── Kitchen Display alerts ────────────────────────────────────────────────────

export const notifyNewKitchenOrder = async (): Promise<void> => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🍽 New Order!',
        body: 'New order received in kitchen',
        sound: 'order_alert.wav',
        data: { type: 'kitchen_new_order' },
      },
      trigger: orderTrigger(),
    });
  } catch {}
};

export const notifyOrderPreparing = async (tableNumber: string, orderNumber: string): Promise<void> => {
  try {
    const label = tableNumber ? `Table ${tableNumber}` : `Order ${orderNumber}`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '👨‍🍳 Preparing',
        body: `${label} is being prepared`,
        data: { type: 'order_preparing' },
      },
      trigger: orderTrigger(),
    });
  } catch {}
};

export const notifyOrderReady = async (tableNumber: string, orderNumber: string): Promise<void> => {
  try {
    const label = tableNumber ? `Table ${tableNumber}` : `Order ${orderNumber}`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Order Ready!',
        body: `${label} is ready to serve`,
        sound: 'order_alert.wav',
        data: { type: 'order_ready' },
      },
      trigger: orderTrigger(),
    });
  } catch {}
};
