import { publicFetch } from './client.ts';

export function callWaiter(
  hotelId:     string,
  tableNumber: string,
  message:     string,
): Promise<{ ok: boolean }> {
  return publicFetch<{ ok: boolean }>('/public/qr/waiter-call', {
    method: 'POST',
    body:   JSON.stringify({ hotelId, tableNumber, message }),
  });
}
