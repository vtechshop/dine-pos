// Phase 5 · Batch 3 regression — exact paise on the POS (3A) and held-bill totals (3B).
import { describe, it, expect } from 'vitest';
import { formatMoney, formatMoneyAbs, formatMoneySigned } from '../money';
import { billHtml, type PrintableBill } from '../printBill';
import { calcCartTotals, heldTotals, type CartItem } from '../../context/CashierContext';

const item = (price: number, quantity: number, taxPercent: number, modifierTotal = 0): CartItem =>
  ({ id: `${price}:${quantity}`, productId: 'p', productName: 'x', price, modifierTotal, quantity, taxPercent } as unknown as CartItem);

describe('3A money formatter: exact paise, never rounded to the rupee', () => {
  it('keeps paise and Indian grouping', () => {
    expect(formatMoney('₹', 574.8)).toBe('₹574.80');
    expect(formatMoney('₹', 252)).toBe('₹252.00');
    expect(formatMoney('₹', 123456.789)).toBe('₹1,23,456.79');
    expect(formatMoney('₹', -20)).toBe('-₹20.00');
    expect(formatMoneyAbs('₹', -74.8)).toBe('₹74.80');
    expect(formatMoneySigned('₹', 0.2)).toBe('+₹0.20');
    expect(formatMoneySigned('₹', -0.2)).toBe('-₹0.20');
  });
});

describe('3A cart totals = server arithmetic (each line rounded to the paisa)', () => {
  it('2 × Paneer 240 @5 % + Lime 60 @18 % = 574.80 (not 575)', () => {
    const t = calcCartTotals([item(240, 2, 5), item(60, 1, 18)]);
    expect(t).toEqual({ subtotal: 540, taxTotal: 34.8, grandTotal: 574.8 });
  });
  it('rounds tax per line like the server (two lines of 10.805 → 21.62)', () => {
    const t = calcCartTotals([item(216.1, 1, 5), item(216.1, 1, 5)]);   // 10.805 each → 10.81
    expect(t.taxTotal).toBe(21.62);
  });
  it('discount never exceeds the bill', () => {
    expect(calcCartTotals([item(100, 1, 0)], 500).grandTotal).toBe(0);
  });
});

describe('3B held bill loaded on another device shows its real amount (not ₹0)', () => {
  const items = [item(180, 3, 5)];   // 567.00
  it('uses the totals stored with the bill', () => {
    expect(heldTotals(items, { subtotal: 540, taxTotal: 27, grandTotal: 547 })).toEqual({ subtotal: 540, taxTotal: 27, grandTotal: 547 });
  });
  it('recomputes older held bills from their items and discount', () => {
    expect(heldTotals(items, {}).grandTotal).toBe(567);
    expect(heldTotals(items, { discountAmount: 20 }).grandTotal).toBe(547);
    expect(heldTotals(items, { discountAmount: 10, discountType: 'percent' }).grandTotal).toBe(510.3);
  });
});

describe('3B invoice shows what was ordered on each line', () => {
  it('prints the size, add-ons and note, and escapes them', () => {
    const html = billHtml({
      orderNumber: 'ORD-B3L', createdAt: '2026-11-21T10:00:00.000Z', isParcel: true, status: 'served',
      items: [{
        productName: 'Veg Biryani', variantName: 'Full', quantity: 1, price: 210, total: 220.5,
        selectedModifiers: [{ modifierOptionName: 'Extra Raita', modifierPrice: 30 }], notes: 'no <onion>',
      }],
      subtotal: 210, taxTotal: 10.5, grandTotal: 220.5,
    }, { currencySymbol: '₹' });
    for (const s of ['Veg Biryani (Full)', '+ Extra Raita ₹30.00', 'Note: no &lt;onion&gt;', '1 × ₹210.00', '₹220.50']) {
      expect(html).toContain(s);
    }
  });
});

describe('3A invoice lines add up (coupon, discount at payment, voucher, part payment)', () => {
  const bill: PrintableBill = {
    orderNumber: 'ORD-B3', createdAt: '2026-11-21T10:00:00.000Z', isParcel: true,
    items: [{ productName: 'Paneer Tikka', quantity: 2, price: 240, total: 504 }],
    subtotal: 480, taxTotal: 24, discountAmount: 10, couponDiscount: 30, paymentDiscount: 20,
    // 480 + 24 − 10 − 30 − 20 = 444 bill total; − 100 voucher = 344 to pay; 200 paid → 144 due
    giftVoucherAmount: 100, grandTotal: 344, amountSettled: 200, paymentMethod: null, status: 'served',
  };
  it('shows every discount and tender, and the balance of a part-paid bill — all lines add up', () => {
    const html = billHtml(bill, { currencySymbol: '₹' });
    for (const s of ['Discount', '-₹10.00', 'Coupon', '-₹30.00', 'Discount at payment', '-₹20.00',
      'Bill total', '₹444.00', 'Gift voucher', '-₹100.00', 'TO PAY', '₹344.00', 'Paid', '₹200.00', 'Balance due', '₹144.00']) {
      expect(html).toContain(s);
    }
    expect(480 + 24 - 10 - 30 - 20).toBe(444);
    expect(444 - 100).toBe(bill.grandTotal);
  });
});
