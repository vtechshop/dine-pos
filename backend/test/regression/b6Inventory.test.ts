// Phase 5 · Batch 6 (Inventory and purchasing) — server rules that the browser tests cannot reach
// directly: sold-out / counted-stock checks on POS orders, the conditional stock deduction, and the
// purchasing records that could exist only once per hotel.
import fs from 'fs';
import path from 'path';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/server', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../../src/models/Product', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../../src/models/ModifierGroup', () => ({ __esModule: true, default: { find: jest.fn() } }));

import ProductModel from '../../src/models/Product';
import { validateAndEnrichItems } from '../../src/routes/orderRoutes';
import GRN from '../../src/models/GRN';
import VendorPayment from '../../src/models/VendorPayment';
import VendorReturn from '../../src/models/VendorReturn';
import { parseOpeningBalance } from '../../src/utils/vendorOpeningBalance';

const HOTEL = '64b7f0c2a1b2c3d4e5f60718';
const JAMUN = '64b7f0c2a1b2c3d4e5f60c01';
const SAMOSA = '64b7f0c2a1b2c3d4e5f60c02';
const DOSA = '64b7f0c2a1b2c3d4e5f60c03';
const catalog = [
  { _id: JAMUN, name: 'Gulab Jamun', price: 80, taxPercent: 5, isAvailable: true, stock: 2, hotelId: HOTEL },
  { _id: SAMOSA, name: 'Samosa', price: 30, taxPercent: 5, isAvailable: false, stock: -1, hotelId: HOTEL },
  { _id: DOSA, name: 'Plain Dosa', price: 50, taxPercent: 5, isAvailable: true, stock: -1, hotelId: HOTEL },
];
beforeEach(() => {
  jest.clearAllMocks();
  (ProductModel.find as jest.Mock).mockImplementation((q: any) => ({
    lean: jest.fn().mockResolvedValue(catalog.filter(p => q._id.$in.map(String).includes(p._id))),
  }));
});
const line = (product: string, quantity: number) => ({ product, quantity, productName: 'x' });

describe('Batch 6: POS orders respect availability and counted stock', () => {
  it('a switched-off / sold-out dish is refused by name (P4-INV-02)', async () => {
    const r = await validateAndEnrichItems([line(SAMOSA, 1)], HOTEL);
    expect([r.code, r.error]).toEqual(['ITEM_UNAVAILABLE', 'Samosa is sold out or switched off. Remove it from the bill.']);
  });

  it('more than the counted stock is refused, counting every line of the dish (P4-INV-03)', async () => {
    const r = await validateAndEnrichItems([line(JAMUN, 1), line(JAMUN, 2)], HOTEL);
    expect([r.code, r.error]).toEqual(['NOT_ENOUGH_STOCK', 'Only 2 Gulab Jamun left — the bill has 3. Change the quantity.']);
  });

  it('within stock is accepted and the counted dishes are reported for the conditional deduction', async () => {
    const r = await validateAndEnrichItems([line(JAMUN, 2), line(DOSA, 10)], HOTEL);
    expect(r.error).toBeNull();
    expect([...(r.trackedStock ?? new Map())]).toEqual([[JAMUN, 2]]);   // Dosa (−1) is not counted stock
  });

  it('the deduction only takes stock that is there, and a shortfall rolls the order back', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/orderRoutes.ts'), 'utf8');
    expect(src).toMatch(/filter: \{ _id: new mongoose\.Types\.ObjectId\(id\), hotelId: req\.hotelId, stock: \{ \$gte: qty \} \}/);
    expect(src).toMatch(/if \(sw\.matchedCount !== stockBulkOps\.length\)/);
    expect(src).not.toMatch(/\$max: \[\{ \$subtract: \['\$stock', item\.quantity\] \}, 0\]/);   // the old clamp
    expect(src.match(/invalidateProductList\(req\.hotelId!\)/g)).toHaveLength(2);           // sale and cancel
    // a retried transaction (write conflict) inserts the order again instead of updating one never committed
    expect(src).toMatch(/withTransaction\(async \(\) => \{[\s\S]{0,600}order\.isNew = true;/);
  });
});

describe('Batch 6: purchasing records without a client key can exist more than once per hotel', () => {
  it('GRN, vendor payment and vendor return get their own key (index unchanged)', () => {
    for (const M of [GRN, VendorPayment, VendorReturn] as any[]) {
      const a = new M({}).idempotencyKey;
      const b = new M({}).idempotencyKey;
      expect(a).toMatch(/^auto:[0-9a-f]{24}$/);
      expect(a).not.toBe(b);
      expect(new M({ idempotencyKey: 'client-key-1' }).idempotencyKey).toBe('client-key-1');
    }
  });
});

describe('Batch 6: vendor opening balance and invoice payment', () => {
  it('opening balance from the form: a number ≥ 0, to the paisa', () => {
    expect(parseOpeningBalance('500')).toEqual({ amount: 500 });
    expect(parseOpeningBalance(120.456)).toEqual({ amount: 120.46 });
    expect(parseOpeningBalance(-1)).toEqual({ error: 'Opening balance (what you owe the vendor) cannot be negative' });
    expect(parseOpeningBalance('abc')).toEqual({ error: 'Opening balance must be a number' });
  });

  it('marking an invoice paid records the vendor payment once, in the same transaction', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/purchaseInvoiceRoutes.ts'), 'utf8');
    const route = src.slice(src.indexOf("router.post('/:id/mark-paid'"));
    expect(route.indexOf('session.withTransaction')).toBeLessThan(route.indexOf("status: 'paid'"));
    expect(route).toMatch(/await recordVendorPayment\(/);
    expect(route).toMatch(/idempotencyKey:\s+`invoice-paid:\$\{invoice\._id\}`/);
  });
});
