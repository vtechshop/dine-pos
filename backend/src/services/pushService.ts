import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import SADevice from '../models/SADevice';
import { logger } from '../utils/logger';

const expo = new Expo();

export async function sendLeadPushToSuperAdmins(
  title: string,
  body: string,
): Promise<void> {
  try {
    const devices = await SADevice.find({}).lean();
    if (!devices.length) return;

    const messages: ExpoPushMessage[] = devices
      .filter(d => Expo.isExpoPushToken(d.pushToken))
      .map(d => ({
        to: d.pushToken,
        title,
        body,
        sound: 'default' as const,
        data: { type: 'new_lead' },
      }));

    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        logger.error('Expo push chunk error', { err: String(err) });
      }
    }
  } catch (err) {
    logger.error('sendLeadPushToSuperAdmins error', { err: String(err) });
  }
}
