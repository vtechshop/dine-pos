/**
 * Audit (Phase 2) — table / guest billing must not double-charge prepaid QR
 * orders, charge unpaid ones, or charge cancelled ones.
 *
 * BILL-10  isDueAtCounter: only counter-payable orders count toward the amount due.
 * BILL-11  amountDueAtCounter sums only those orders (2-dp).
 * BILL-12  counterBillingOrderUpdates: counter orders get the counter payment
 *          method; prepaid-online orders are completed but keep 'razorpay';
 *          payment_pending / cancelled / already-completed orders are untouched.
 */

import { isDueAtCounter, amountDueAtCounter, counterBillingOrderUpdates } from '../../src/utils/counterBilling';

describe('BILL-10 — isDueAtCounter', () => {
  it.each([
    [{ status: 'served',          paymentMethod: 'cash' },     true],
    [{ status: 'served',          paymentMethod: undefined },  true],
    [{ status: 'pending',         paymentMethod: 'cash' },     true],
    [{ status: 'served',          paymentMethod: 'razorpay' }, false], // paid online (QR)
    [{ status: 'payment_pending', paymentMethod: 'razorpay' }, false], // never paid, never cooked
    [{ status: 'cancelled',       paymentMethod: 'cash' },     false],
  ])('%o → %s', (order, expected) => {
    expect(isDueAtCounter(order)).toBe(expected);
  });
});

describe('BILL-11 — amountDueAtCounter', () => {
  it('a table with a counter order, a prepaid QR order, an unpaid QR order and a cancelled order owes only the counter order', () => {
    const orders = [
      { status: 'served',          paymentMethod: 'cash',     grandTotal: 210.5 },
      { status: 'served',          paymentMethod: 'razorpay', grandTotal: 447.3 },
      { status: 'payment_pending', paymentMethod: 'razorpay', grandTotal: 99 },
      { status: 'cancelled',       paymentMethod: 'cash',     grandTotal: 50 },
    ];
    expect(amountDueAtCounter(orders)).toBe(210.5);
  });

  it('rounds to 2 decimal places', () => {
    expect(amountDueAtCounter([
      { status: 'served', grandTotal: 0.1 },
      { status: 'served', grandTotal: 0.2 },
    ])).toBe(0.3);
  });
});

describe('BILL-12 — counterBillingOrderUpdates', () => {
  const scope = { sessionId: 'S1', guestId: 'G1' };
  const { counter, prepaid } = counterBillingOrderUpdates(scope, 'cash');

  it('counter orders: completed with the counter payment method', () => {
    expect(counter.filter).toMatchObject(scope);
    expect(counter.filter.paymentMethod).toEqual({ $ne: 'razorpay' });
    expect(counter.update).toEqual({ $set: { paymentMethod: 'cash', status: 'completed' } });
  });

  it('prepaid online orders: completed but payment method untouched', () => {
    expect(prepaid.filter).toMatchObject({ ...scope, paymentMethod: 'razorpay' });
    expect(prepaid.update).toEqual({ $set: { status: 'completed' } });
    expect(JSON.stringify(prepaid.update)).not.toContain('paymentMethod');
  });

  it('never touches payment_pending, cancelled or already-completed orders', () => {
    for (const f of [counter.filter, prepaid.filter]) {
      expect((f.status as { $nin: string[] }).$nin).toEqual(
        expect.arrayContaining(['cancelled', 'payment_pending', 'completed']),
      );
    }
  });
});
