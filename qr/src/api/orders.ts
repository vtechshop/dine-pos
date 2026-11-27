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
  /** Same id for every retry of the same cart: the server returns the order it already made. */
  clientOrderId?: string;
}

interface PlaceOrderResponse {
  guestToken: string;
  order:      { _id: string; orderNumber: string; grandTotal: number };
}

// Maps CartEntry → the shape /api/public/qr/orders expects.
function toApiItems(entries: CartEntry[]) {
  return entries.map((e) => ({
    product:  e.productId,
    quantity: e.quantity,
    price:    e.price + e.modifierTotal,
    variantId: e.variantId || undefined,
    selectedModifiers: (e.selectedModifiers ?? []).map(m => ({
      ...m,
      modifierTotal: m.modifierPrice * e.quantity,
    })),
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
        clientOrderId: params.clientOrderId,
      }),
    });
  }

  // Legacy stateless flow — no session, no guestToken.
  // Phase 5 · Batch 4 (P4-QR-10): QR orders are paid online here too (the server refuses
  // anything else), and the server answers with the order itself, not { order }.
  type LegacyOrder = { _id: string; orderNumber: string; grandTotal: number };
  const res = await publicFetch<LegacyOrder | { order: LegacyOrder }>(
    '/public/orders',
    {
      method: 'POST',
      body: JSON.stringify({
        hotelId:       params.hotelId,
        tableNumber:   params.tableNumber,
        items:         toApiItems(params.items),
        customerName:  params.name,
        notes:         params.notes,
        orderSource:   'qr',
        paymentMethod: 'razorpay',
        offlineId:     params.clientOrderId,
      }),
    },
  );

  // Wrap legacy response into the same shape for the caller
  return { guestToken: '', order: 'order' in res ? res.order : res };
}
