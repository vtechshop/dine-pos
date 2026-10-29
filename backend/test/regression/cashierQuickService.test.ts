/**
 * Cashier "Confirm & Pay" for counter orders: cashiers may not set an order to 'served',
 * so takeaway and counter delivery must be completable straight from 'pending'.
 */
import fs from 'fs';
import path from 'path';
import { isQuickServiceOrder } from '../../src/utils/quickService';

describe('isQuickServiceOrder', () => {
  it('takeaway is quick service', () => {
    expect(isQuickServiceOrder({ orderSource: 'takeaway', isParcel: true })).toBe(true);
    expect(isQuickServiceOrder({ orderSource: 'takeaway', isParcel: false })).toBe(true);
  });

  it('counter delivery (admin-source parcel) is quick service', () => {
    expect(isQuickServiceOrder({ orderSource: 'admin', isParcel: true })).toBe(true);
  });

  it('dine-in, non-parcel admin orders and other sources still need ready/served', () => {
    expect(isQuickServiceOrder({ orderSource: 'dine-in', isParcel: false })).toBe(false);
    expect(isQuickServiceOrder({ orderSource: 'admin', isParcel: false })).toBe(false);
    expect(isQuickServiceOrder({ orderSource: 'admin' })).toBe(false);
    expect(isQuickServiceOrder({ orderSource: 'qr', isParcel: true })).toBe(false);
    expect(isQuickServiceOrder({ orderSource: 'swiggy', isParcel: true })).toBe(false);
    expect(isQuickServiceOrder({})).toBe(false);
  });

  it('the status route uses the helper for both the cashier gate and the completion filter', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/orderRoutes.ts'), 'utf8');
    expect(src).toContain('const isQuickService = isQuickServiceOrder(existing as any);');
    expect(src).not.toContain("const isQuickService = (existing as any).orderSource === 'takeaway';");
    expect(src).toMatch(/completableStatuses = isQuickService\s*\?\s*\['served', 'ready', 'pending'\]/);
  });
});
