/**
 * Pay before kitchen: unpaid orders are held from the kitchen until the counter takes
 * payment, and an order paid ahead is never charged again at the table.
 */
import fs from 'fs';
import path from 'path';
import { isDueAtCounter, isPaidAhead, amountDueAtCounter, counterBillingOrderUpdates } from '../../src/utils/counterBilling';
import { isHeldForCounterPayment } from '../../src/utils/payBeforeKitchen';

const route = (f: string) => fs.readFileSync(path.join(__dirname, '../../src/routes', f), 'utf8');

describe('counter billing — orders paid ahead', () => {
  it('an order paid at the counter (paymentTime set) is not due at the table', () => {
    expect(isDueAtCounter({ status: 'preparing', paymentMethod: 'cash', paymentTime: new Date() })).toBe(false);
    expect(isPaidAhead({ status: 'served', paymentMethod: 'upi', paymentTime: '2026-10-31T10:00:00Z' })).toBe(true);
  });

  it('an unpaid kitchen order is still due', () => {
    expect(isDueAtCounter({ status: 'preparing', paymentMethod: 'cash', paymentTime: null })).toBe(true);
    expect(isDueAtCounter({ status: 'pending', paymentMethod: 'cash' })).toBe(true);
  });

  it('held, cancelled and online orders are not due', () => {
    expect(isDueAtCounter({ status: 'payment_pending', paymentMethod: 'cash' })).toBe(false);
    expect(isDueAtCounter({ status: 'cancelled', paymentMethod: 'cash' })).toBe(false);
    expect(isDueAtCounter({ status: 'pending', paymentMethod: 'razorpay' })).toBe(false);
  });

  it('the table total skips orders paid ahead', () => {
    expect(amountDueAtCounter([
      { status: 'served', paymentMethod: 'cash', grandTotal: 100 },
      { status: 'served', paymentMethod: 'cash', paymentTime: new Date(), grandTotal: 250 },
      { status: 'payment_pending', paymentMethod: 'cash', grandTotal: 75 },
    ])).toBe(100);
  });

  it('billing a table closes paid-ahead orders without overwriting how they were paid', () => {
    const u = counterBillingOrderUpdates({ sessionId: 's1' }, 'card');
    expect(u.counter.filter).toMatchObject({ sessionId: 's1', paymentTime: null, paymentMethod: { $ne: 'razorpay' } });
    expect(u.counter.update).toEqual({ $set: { paymentMethod: 'card', status: 'completed' } });
    expect((u.prepaid.filter as any).$or).toEqual([{ paymentMethod: 'razorpay' }, { paymentTime: { $ne: null } }]);
    expect(u.prepaid.update).toEqual({ $set: { status: 'completed' } });
  });
});

describe('held orders', () => {
  it('a counter order waiting in payment_pending is held; an online one is not', () => {
    expect(isHeldForCounterPayment({ status: 'payment_pending', paymentMethod: 'cash' })).toBe(true);
    expect(isHeldForCounterPayment({ status: 'payment_pending', paymentMethod: 'razorpay' })).toBe(false);
    expect(isHeldForCounterPayment({ status: 'pending', paymentMethod: 'cash' })).toBe(false);
  });
});

describe('order routes — wiring', () => {
  const orders = route('orderRoutes.ts');

  it('POST /orders holds unpaid orders when the setting is on, and skips KOT + new_order for them', () => {
    expect(orders).toContain("order.status = 'payment_pending';");
    expect(orders).toContain('await payBeforeKitchenEnabled(req.hotelId!)');
    expect(orders).toContain('if (!heldForPayment) scheduleKOTPrint(');
    expect(orders).toContain('if (!heldForPayment) emitNewOrder(req.hotelId!, order);');
  });

  it('payNow is counter staff only and records the payment time', () => {
    expect(orders).toMatch(/const payNow = b\.payNow === true && \(req\.role === 'cashier' \|\| req\.role === 'admin'\);/);
    expect(orders).toContain('order.paymentTime = new Date();');
  });

  it('POST /:id/pay refuses closed, already paid and online orders, and writes conditionally', () => {
    expect(orders).toContain("router.post('/:id/pay', requireCashierOrAdmin");
    expect(orders).toContain("code: 'ALREADY_PAID'");
    expect(orders).toContain("code: 'ONLINE_PAYMENT_PENDING'");
    expect(orders).toContain("code: 'ORDER_CLOSED'");
    expect(orders).toMatch(/_id: req\.params\.id, hotelId: req\.hotelId, paymentTime: null,/);
  });

  it('releasing a held order sends its KOT and new_order', () => {
    const pay = orders.slice(orders.indexOf("router.post('/:id/pay'"));
    expect(pay).toMatch(/if \(held\) \{\s*scheduleKOTPrint\(/);
    expect(pay).toContain('emitNewOrder(req.hotelId!, updated);');
  });

  it('the cashier list shows held counter orders but not online ones, with paymentTime', () => {
    expect(orders).toContain("{ status: 'payment_pending', paymentMethod: { $ne: 'razorpay' } },");
    expect(orders).toContain('paymentTime: 1,');
  });

  it('the kitchen list never includes held orders', () => {
    expect(orders).toMatch(/router\.get\('\/kitchen'[\s\S]{0,300}status: \{ \$in: \['pending', 'preparing', 'ready'\] \}/);
  });
});

describe('public order routes — held when the setting is on', () => {
  it('QR/menu cash orders and kiosk cash orders wait at the counter', () => {
    expect(route('menuRoutes.ts')).toContain("isRazorpayOrder || await payBeforeKitchenEnabled(String(hotelId)) ? 'payment_pending' : 'pending'");
    const qr = route('qrRoutes.ts');
    expect(qr).toContain('const heldForCounter = isKiosk && !kioskWantsRazorpay && await payBeforeKitchenEnabled(String(hotelId));');
    expect(qr).toContain("if (validSource === 'kiosk' && !kioskWantsRazorpay && !heldForCounter) {");
  });
});
