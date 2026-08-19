import { apiFetch } from './client';

export interface ServerHeldBill {
  _id: string;
  hotelId: string;
  cashierId: string;
  cashierName?: string;
  label?: string;
  items: any[];
  metadata: {
    orderType?: string;
    tableId?: string;
    tableNumber?: string;
    tableName?: string;
    customerName?: string;
    customerPhone?: string;
    deliveryAddress?: string;
    deliveryCharge?: number;
    discountAmount?: number;
    discountType?: string;
    couponCode?: string;
    voucherCode?: string;
    loyaltyPoints?: number;
    loyaltyDiscount?: number;
    notes?: string;
  };
  heldAt: string;
  terminal?: string;
}

export interface CreateHeldBillPayload {
  label?: string;
  items: any[];
  metadata?: Record<string, unknown>;
  heldAt?: string;
  terminal?: string;
}

export const listHeldBills = (): Promise<ServerHeldBill[]> =>
  apiFetch<ServerHeldBill[]>('/held-bills');

export const createHeldBill = (data: CreateHeldBillPayload): Promise<ServerHeldBill> =>
  apiFetch<ServerHeldBill>('/held-bills', {
    method: 'POST',
    body:   JSON.stringify(data),
  });

export const deleteHeldBill = (id: string): Promise<{ message: string }> =>
  apiFetch<{ message: string }>(`/held-bills/${id}`, { method: 'DELETE' });
