import type { QrSessionConfig } from '../types/qr.ts';
import { publicFetch } from './client.ts';

export function fetchSessionConfig(
  hotelId:    string,
  guestToken: string | null,
): Promise<QrSessionConfig> {
  return publicFetch<QrSessionConfig>('/public/qr/session', {
    method: 'POST',
    body:   JSON.stringify({ hotelId, guestToken }),
  });
}
