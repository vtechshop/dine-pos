import type { CartEntry } from '../types/qr.ts';
import { publicFetch } from './client.ts';

interface PlaceOrderParams {
  hotelId:       string;
  tableNumber:   string;
  items:         CartEntry[];
  guestToken:    string | null;
  name?:         string;
  phone?:        string;
  notes?:        string;
  tableSessions: boolean;
}

interface PlaceOrderResponse {
  guestToken: string;
  order:      { _id: string; orderNumber: string; grandTotal: number };
}

// Maps CartEntry → the shape /api/public/qr/orders expects.
// The backend uses `product` (ObjectId) + `quantity`.
function toApiItems(entries: CartEntry[]) {
  return entries.map((e) => ({
    product:  e.productId,
    quantity: e.quantity,
    notes:    e.notes || undefined,
  }));
}

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResponse> {
  if (params.tableSessions) {
    // Full QR flow — creates/resumes a guest session, returns guestToken
    return publicFetch<PlaceOrderResponse>('/public/qr/orders', {
      method: 'POST',
      body: JSON.stringify({
        hotelId:     params.hotelId,
        tableNumber: params.tableNumber,
        items:       toApiItems(params.items),
        guestToken:  params.guestToken ?? undefined,
        name:        params.name,
        phone:       params.phone,
        notes:       params.notes,
        orderSource: 'qr',
      }),
    });
  }

  // Legacy stateless flow — no session, no guestToken
  const res = await publicFetch<{ order: { _id: string; orderNumber: string; grandTotal: number } }>(
    '/public/orders',
    {
      method: 'POST',
      body: JSON.stringify({
        hotelId:     params.hotelId,
        tableNumber: params.tableNumber,
        items:       toApiItems(params.items),
        customerName: params.name,
        notes:       params.notes,
        orderSource: 'qr',
      }),
    },
  );

  // Wrap legacy response into the same shape for the caller
  return { guestToken: '', order: res.order };
}
