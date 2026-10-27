/**
 * Audit (Phase 2) — POS pricing integrity.
 *
 * BILL-01  validateAndEnrichItems rejects lines without a product reference
 *          (previously passed through with the client's price / taxPercent).
 * BILL-02  Lines with a product always take price and tax from the DB, never
 *          from the client payload.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/server', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../../src/models/Product', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../../src/models/ModifierGroup', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

import ProductModel from '../../src/models/Product';
import { validateAndEnrichItems } from '../../src/routes/orderRoutes';

const HOTEL = '64b7f0c2a1b2c3d4e5f60718';
const PROD  = '64b7f0c2a1b2c3d4e5f60c01';

function leanResolving(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

beforeEach(() => jest.clearAllMocks());

describe('BILL-01 — POS lines must reference a product', () => {
  it('rejects a line with no product (client price ₹1, 0% GST)', async () => {
    (ProductModel.find as jest.Mock).mockReturnValue(leanResolving([]));
    const { items, error } = await validateAndEnrichItems(
      [{ productName: 'Andhra Chicken Meals', price: 1, taxPercent: 0, quantity: 1 }],
      HOTEL,
    );
    expect(error).toMatch(/not linked to a product/);
    expect(items).toEqual([]);
  });

  it('rejects a line whose product is not a valid id', async () => {
    (ProductModel.find as jest.Mock).mockReturnValue(leanResolving([]));
    const { error } = await validateAndEnrichItems(
      [{ product: 'abc', productName: 'X', price: 1, quantity: 1 }],
      HOTEL,
    );
    expect(error).toMatch(/not linked to a product/);
  });

  it('rejects the whole order if any one line is product-less', async () => {
    (ProductModel.find as jest.Mock).mockReturnValue(leanResolving([
      { _id: PROD, name: 'Tea', price: 20, taxPercent: 5, isAvailable: true, hotelId: HOTEL },
    ]));
    const { error } = await validateAndEnrichItems(
      [
        { product: PROD, productName: 'Tea', price: 20, quantity: 1 },
        { productName: 'Free item', price: 0, quantity: 5 },
      ],
      HOTEL,
    );
    expect(error).toMatch(/not linked to a product/);
  });
});

describe('BILL-02 — product lines are priced from the DB', () => {
  it('ignores the client price and taxPercent', async () => {
    (ProductModel.find as jest.Mock).mockReturnValue(leanResolving([
      { _id: PROD, name: 'Tea', price: 20, taxPercent: 5, isAvailable: true, hotelId: HOTEL },
    ]));
    const { items, error } = await validateAndEnrichItems(
      [{ product: PROD, productName: 'Tea', price: 1, taxPercent: 0, quantity: 2 }],
      HOTEL,
    );
    expect(error).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].price).toBe(20);
    expect(items[0].taxPercent).toBe(5);
  });
});
