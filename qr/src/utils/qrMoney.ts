// Phase 5 · Batch 4: what the guest sees in the cart is what the server will charge.
// Mirrors backend/src/utils/qrOrderItems.ts:
//   unit price = chosen size's price, else the QR channel price (when set), else the base price,
//                plus each add-on's price;
//   line tax   = unit × quantity × tax % (unrounded); the cart sums lines and rounds to paise
//                with toFixed(2), exactly as the order does.
import type { Product } from '@dinepos/shared/types';

type WithChannel = Product & { channelPrices?: { qr?: number | null } };

/** Price of the dish on the QR menu before size / add-ons. */
export function qrBasePrice(product: Product): number {
  const qr = (product as WithChannel).channelPrices?.qr;
  return qr && qr > 0 ? qr : product.price;
}

export interface CartLineForTotals {
  price:          number;   // unit price (size or base)
  modifierTotal:  number;   // add-ons per unit
  quantity:       number;
  taxPercent?:    number;
}

export interface CartMoney {
  subtotal: number;
  tax:      number;
  total:    number;
}

const paise = (n: number) => +n.toFixed(2);

export function cartMoney(lines: CartLineForTotals[]): CartMoney {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const amount = (l.price + l.modifierTotal) * l.quantity;
    subtotal += amount;
    tax += (amount * (l.taxPercent ?? 0)) / 100;
  }
  return { subtotal: paise(subtotal), tax: paise(tax), total: paise(subtotal + tax) };
}
