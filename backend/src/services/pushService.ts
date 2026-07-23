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
    const staleTokens: string[] = [];

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          if (
            ticket.status === 'error' &&
            (ticket.details as { error?: string } | undefined)?.error === 'DeviceNotRegistered'
          ) {
            const token = (chunk[i] as ExpoPushMessage & { to: string }).to;
            staleTokens.push(token);
          }
        });
      } catch (err) {
        logger.error('Expo push chunk error', { err: String(err) });
      }
    }

    if (staleTokens.length) {
      await SADevice.deleteMany({ pushToken: { $in: staleTokens } }).catch(err =>
        logger.error('pushService: failed to remove stale tokens', { count: staleTokens.length, err: String(err) }),
      );
      logger.info('pushService: removed stale Expo tokens', { count: staleTokens.length });
    }
  } catch (err) {
    logger.error('sendLeadPushToSuperAdmins error', { err: String(err) });
  }
}
