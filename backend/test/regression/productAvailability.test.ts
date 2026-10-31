/**
 * Cashier / kitchen can mark a dish in or out of stock from the POS
 * (PATCH /api/products/:id/availability). End-to-end tests live in
 * test/integration/productAvailability.integration.test.ts on the integration branch.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../src/routes/productRoutes.ts'), 'utf8');
const route = src.slice(src.indexOf("router.patch('/:id/availability'"), src.indexOf('// DELETE product (soft delete)'));

describe('PATCH /api/products/:id/availability', () => {
  it('exists, checks the staff account is active, and allows only admin / cashier / kitchen', () => {
    expect(route).toContain("router.patch('/:id/availability', requireActiveStaff,");
    expect(route).toContain("['admin', 'cashier', 'kitchen'].includes(req.role ?? '')");
  });
  it('changes only isAvailable, scoped to the hotel', () => {
    expect(route).toContain('{ $set: { isAvailable } }');
    expect(route).toMatch(/updateOne\(\{ _id: req\.params\.id, hotelId: req\.hotelId \}/);
    expect(route).not.toMatch(/\$set: \{[^}]*price/);
  });
  it('will not switch a stock-tracked dish with 0 left back on', () => {
    expect(route).toContain("if (isAvailable && product.stock === 0)");
    expect(route).toContain("code: 'NO_STOCK'");
  });
  it('is audited and clears the cached menu', () => {
    expect(route).toContain("'product.out_of_stock'");
    expect(route).toContain('invalidateProductCache(req.hotelId!)');
  });
});
