import type { QrBill } from '../types/qr.ts';
import { publicFetch } from './client.ts';

export function fetchBill(hotelId: string, guestToken: string): Promise<QrBill> {
  const params = new URLSearchParams({ hotel: hotelId, token: guestToken });
  return publicFetch<QrBill>(`/public/qr/bill?${params.toString()}`);
}
