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

export const setupNotifications = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.setNotificationChannelAsync('order_alerts', {
      name: 'New Order Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 200, 100, 300],
      lightColor: '#E8380D',
      enableVibrate: true,
      sound: 'order_alert.wav',
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
      trigger: { channelId: 'order_alerts' } as any,
    });
  } catch {}
};
