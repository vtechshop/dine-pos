import { describe, it, expect } from 'vitest';
import { isDueAtCounter, sumDue, sumPaidOnline } from '../counterBilling';

// Must match backend/src/utils/counterBilling.ts (BILL-10/11 in the backend suite).
const table = [
  { status: 'served',          paymentMethod: 'cash',     grandTotal: 210.5, subtotal: 200, taxTotal: 10.5 },
  { status: 'served',          paymentMethod: 'razorpay', grandTotal: 447.3, subtotal: 426, taxTotal: 21.3 },
  { status: 'payment_pending', paymentMethod: 'razorpay', grandTotal: 99,    subtotal: 94,  taxTotal: 5 },
  { status: 'cancelled',       paymentMethod: 'cash',     grandTotal: 50,    subtotal: 47,  taxTotal: 3 },
];

describe('counter billing (web)', () => {
  it('only counter orders are due', () => {
    expect(table.map(isDueAtCounter)).toEqual([true, false, false, false]);
  });

  it('bill totals exclude prepaid, unpaid-online and cancelled orders', () => {
    expect(sumDue(table)).toBe(210.5);
    expect(sumDue(table, o => o.subtotal)).toBe(200);
    expect(sumDue(table, o => o.taxTotal)).toBe(10.5);
  });

  it('reports what was already paid online (released QR orders only)', () => {
    expect(sumPaidOnline(table)).toBe(447.3);
  });
});
