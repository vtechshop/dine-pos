// Phase 5 · Batch 4 (Kitchen and QR): server-side pricing of a guest's QR order, the kitchen
// ticket lines, and the order of checks in POST /api/public/qr/orders.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Product from '../../src/models/Product';
import ModifierGroup from '../../src/models/ModifierGroup';
import { priceQrItems, type QrPricingRefusal, type QrPricedItems } from '../../src/utils/qrOrderItems';

// the test tsconfig is not strict, so read the two outcomes through these
const refusalOf = (r: unknown) => (r as { refusal: QrPricingRefusal }).refusal;
const resultOf  = (r: unknown) => { const x = r as { result: QrPricedItems; refusal: QrPricingRefusal | null }; if (x.refusal) throw new Error(x.refusal.message); return x.result; };
import { kotLineExtras } from '../../src/utils/printUtils';

// printUtils imports the server for its socket; this test does not need it
jest.mock('../../src/server', () => ({ io: { to: () => ({ emit: () => undefined }), sockets: { sockets: new Map() } } }));

const hotelId = String(new mongoose.Types.ObjectId());
const id = () => new mongoose.Types.ObjectId();
const [PANEER, BIRYANI, LIME, GONE] = [id(), id(), id(), id()];
const [HALF, FULL, GROUP, RAITA, GRAVY] = [id(), id(), id(), id(), id()];

const catalog = [
  { _id: PANEER, name: 'Paneer Tikka', price: 240, taxPercent: 5, isAvailable: true, isDeleted: false,
    variants: [{ _id: HALF, name: 'Half', price: 150 }, { _id: FULL, name: 'Full', price: 280 }], channelPrices: { qr: 250 } },
  { _id: BIRYANI, name: 'Veg Biryani', price: 180, taxPercent: 5, isAvailable: true, isDeleted: false, variants: [] },
  { _id: LIME, name: 'Fresh Lime', price: 60, taxPercent: 18, isAvailable: true, isDeleted: false, variants: [], channelPrices: { qr: 65 } },
  { _id: GONE, name: 'Gulab Jamun', price: 90, taxPercent: 5, isAvailable: false, isDeleted: false, variants: [] },
];
const groups = [{ _id: GROUP, name: 'Add-ons', options: [
  { _id: RAITA, name: 'Extra Raita', price: 30, isActive: true },
  { _id: GRAVY, name: 'Extra Gravy', price: 20, isActive: false },
] }];

beforeEach(() => {
  jest.spyOn(Product, 'find').mockImplementation(((q: any) => ({
    select: () => ({ lean: () => Promise.resolve(catalog.filter(p => q._id.$in.map(String).includes(String(p._id)))) }),
  })) as never);
  jest.spyOn(ModifierGroup, 'find').mockReturnValue({ lean: () => Promise.resolve(groups) } as never);
});
afterEach(() => jest.restoreAllMocks());

describe('Batch 4: QR order lines are priced by the server, like the POS', () => {
  it('size, add-on and note are priced, saved and kept; tax to the paisa', async () => {
    const r = await priceQrItems([
      { product: PANEER, quantity: 1, variantId: FULL, price: 1 /* client price ignored */ },
      { product: BIRYANI, quantity: 2, notes: '  No onions, nut allergy  ',
        selectedModifiers: [{ modifierGroupId: GROUP, modifierOptionId: RAITA, modifierPrice: 0 }] },
      { product: LIME, quantity: 1 },
    ], hotelId, 'qr');
    const lines = resultOf(r).validatedItems.map(i => [i.productName, i.variantName, i.price, i.quantity, i.notes,
      i.selectedModifiers.map((m: any) => [m.modifierOptionName, m.modifierPrice, m.modifierTotal])]);
    expect(lines).toEqual([
      ['Paneer Tikka', 'Full', 280, 1, '', []],                              // size price, not the QR price
      ['Veg Biryani', '', 210, 2, 'No onions, nut allergy', [['Extra Raita', 30, 60]]],
      ['Fresh Lime', '', 65, 1, '', []],                                     // QR channel price without a size
    ]);
    // 280 + 420 + 65 = 765; tax 14 + 21 + 11.70 = 46.70
    expect([resultOf(r).subtotal, +resultOf(r).taxTotal.toFixed(2)]).toEqual([765, 46.7]);
  });

  it('only server values go on the saved line (no client fields are copied)', async () => {
    const r = await priceQrItems([{ product: BIRYANI, quantity: 1, total: 0, taxAmount: 0, isComplimentary: true, kitchenStatus: 'served' }], hotelId, 'qr');
    expect(Object.keys(resultOf(r).validatedItems[0]).sort()).toEqual(
      ['hsnCode', 'notes', 'price', 'product', 'productName', 'quantity', 'selectedModifiers', 'taxAmount', 'taxPercent', 'total', 'variantId', 'variantName']);
    expect(resultOf(r).validatedItems[0].total).toBe(189);
  });

  it('an unavailable or unknown item refuses the order and is named (P4-QR-04)', async () => {
    const r = await priceQrItems([{ product: BIRYANI, quantity: 1 }, { product: GONE, quantity: 1 }, { product: id(), name: 'Old Dish', quantity: 1 }], hotelId, 'qr');
    expect(refusalOf(r)).toBeTruthy();
    expect(refusalOf(r).status).toBe(409);
    expect(refusalOf(r).code).toBe('ITEM_UNAVAILABLE');
    expect(refusalOf(r).message).toBe('Sorry, Gulab Jamun and Old Dish are no longer available. Please remove them from your cart and try again.');
  });

  it('an unknown size or an inactive add-on refuses the order in plain language', async () => {
    for (const line of [
      { product: PANEER, quantity: 1, variantId: id() },
      { product: BIRYANI, quantity: 1, selectedModifiers: [{ modifierGroupId: GROUP, modifierOptionId: GRAVY }] },
    ]) {
      const r = await priceQrItems([line], hotelId, 'qr');
      expect(refusalOf(r)).toBeTruthy();
      expect(refusalOf(r).message).toMatch(/^One of the options you chose is no longer available/);
    }
  });

  it('a line without a product id is refused, not skipped', async () => {
    const r = await priceQrItems([{ product: BIRYANI, quantity: 1 }, { productName: 'Free item', price: 0 }], hotelId, 'qr');
    expect(refusalOf(r)).toBeTruthy();
    expect([refusalOf(r).status, refusalOf(r).code]).toEqual([400, 'INVALID_ITEM']);
  });
});

describe('Batch 4: the kitchen ticket shows size, add-ons and the item note', () => {
  it('lines the thermal printer prints under the dish', () => {
    expect(kotLineExtras({ variantName: 'Full', selectedModifiers: [{ modifierOptionName: 'Extra Raita' }], notes: ' nut allergy ' }))
      .toEqual(['Size: Full', 'Extra Raita', 'Note: nut allergy']);
    expect(kotLineExtras({})).toEqual([]);
  });

  it('the KOT payload carries `modifiers` (what the mobile printer prints) next to the old fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/utils/printUtils.ts'), 'utf8');
    expect(src).toMatch(/modifiers:\s+kotLineExtras\(i as any\)\.length \? kotLineExtras\(i as any\) : undefined/);
    expect(src).toMatch(/modifierNames:/);
  });
});

describe('Batch 4: POST /api/public/qr/orders checks before it creates anything', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/routes/qrRoutes.ts'), 'utf8');
  const handler = src.slice(src.indexOf("router.post('/orders'"));

  it('items and the payment gateway are checked before a session or guest is created (P4-QR-08)', () => {
    const at = (s: string) => handler.indexOf(s);
    expect(at('validateItems(res, clientItems')).toBeGreaterThan(0);
    expect(at('validateItems(res, clientItems')).toBeLessThan(at('findOrCreateOpenSession('));
    expect(at("code: 'NO_PAYMENT_GATEWAY'")).toBeLessThan(at('findOrCreateOpenSession('));
    expect(at("code: 'NO_PAYMENT_GATEWAY'")).toBeLessThan(at('Guest.create('));
  });

  it('a table that does not exist is reported to the guest in plain language (P4-QR-02)', () => {
    expect(handler).toMatch(/code: 'TABLE_NOT_FOUND', message: `Table \$\{given\.slice\(0, 20\)\} was not found at this restaurant/);
    expect(handler).not.toMatch(/tableId or tableNumber is required/);
  });

  it('a name the guest gives is used in every identification mode (P4-QR-07)', () => {
    expect(handler).toMatch(/const displayLabel = cleanName \|\| guestLabel\(guestNumber\);/);
  });
});
