import { describe, it, expect } from 'vitest';
import { billHtml, type PrintableBill } from '../printBill';

const bill: PrintableBill = {
  orderNumber: 'ORD-20261029-002',
  createdAt: '2026-10-29T10:00:00.000Z',
  customerName: '<b>zxvcv</b>',
  isParcel: true,
  items: [{ productName: 'Blueberry Shake', quantity: 1, price: 99, total: 99 }],
  subtotal: 99, taxTotal: 4.95, grandTotal: 104,
  paymentMethod: null, status: 'pending',
};

describe('billHtml', () => {
  it('lists items and totals and marks an unpaid bill', () => {
    const html = billHtml(bill, { hotelName: 'Malu Hotel', gstNumber: '33ABCDE1234F1Z5', currencySymbol: '₹' });
    expect(html).toContain('Malu Hotel');
    expect(html).toContain('GSTIN: 33ABCDE1234F1Z5');
    expect(html).toContain('ORD-20261029-002');
    expect(html).toContain('Blueberry Shake');
    expect(html).toContain('1 × ₹99.00');
    expect(html).toContain('₹104.00');
    expect(html).toContain('Takeaway');
    expect(html).toContain('NOT PAID');
  });

  it('marks a paid bill with its payment method', () => {
    expect(billHtml({ ...bill, status: 'completed', paymentMethod: 'upi' }, {})).toContain('PAID · UPI');
  });

  it('marks an order paid at the counter (still in the kitchen) as paid', () => {
    expect(billHtml({ ...bill, status: 'preparing', paymentMethod: 'cash', paymentTime: '2026-10-31T10:00:00Z' }, {})).toContain('PAID · CASH');
  });

  it('escapes text so names cannot inject HTML', () => {
    const html = billHtml(bill, { hotelName: 'A & B <Cafe>' });
    expect(html).toContain('&lt;b&gt;zxvcv&lt;/b&gt;');
    expect(html).toContain('A &amp; B &lt;Cafe&gt;');
    expect(html).not.toContain('<b>zxvcv</b>');
  });
});
