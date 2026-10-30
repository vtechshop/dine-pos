/**
 * Customer IDs: manual "New Customer" and order/QR auto-create used two separate
 * counters that both started at 1, so IDs collided and the save failed with a
 * misleading "phone already exists". All three now share nextCustomerId().
 */
import fs from 'fs';
import path from 'path';

const taken = new Set<string>();
let seq = 0;

jest.mock('../../src/models/DailyCounter', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn(async () => ({ seq: ++seq })) },
}));
jest.mock('../../src/models/CustomerProfile', () => ({
  __esModule: true,
  default: { exists: jest.fn(async (q: { customerId: string }) => (taken.has(q.customerId) ? { _id: 'x' } : null)) },
}));

import DailyCounter from '../../src/models/DailyCounter';
import { nextCustomerId } from '../../src/utils/customerId';

const HOTEL = '65f0c0ffee00000000abc123';

beforeEach(() => { taken.clear(); seq = 0; jest.clearAllMocks(); });

describe('nextCustomerId', () => {
  it('formats CUST-<last 6 of hotel>-<4-digit seq> from the shared CUST- counter', async () => {
    await expect(nextCustomerId(HOTEL)).resolves.toBe('CUST-ABC123-0001');
    expect((DailyCounter.findOneAndUpdate as jest.Mock).mock.calls[0][0]).toEqual({ key: `CUST-${HOTEL}` });
  });

  it('skips IDs already handed out by the old separate counter', async () => {
    taken.add('CUST-ABC123-0001');
    taken.add('CUST-ABC123-0002');
    await expect(nextCustomerId(HOTEL)).resolves.toBe('CUST-ABC123-0003');
  });

  it('gives up instead of looping forever', async () => {
    (DailyCounter.findOneAndUpdate as jest.Mock).mockResolvedValue({ seq: 1 });
    taken.add('CUST-ABC123-0001');
    await expect(nextCustomerId(HOTEL)).rejects.toThrow('Could not allocate');
  });
});

describe('every customer-creating route uses the shared allocator', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../../src/routes', f), 'utf8');

  it('manual create, order auto-create and QR auto-create', () => {
    expect(read('loyaltyRoutes.ts')).toContain('const generateCustomerId = nextCustomerId;');
    expect(read('qrRoutes.ts')).toContain('const generateCustomerId = nextCustomerId;');
    expect(read('orderRoutes.ts')).toContain('const newCustomerId = await nextCustomerId(req.hotelId!);');
  });

  it('no route keeps its own customer counter', () => {
    for (const f of ['loyaltyRoutes.ts', 'qrRoutes.ts', 'orderRoutes.ts']) {
      expect(read(f)).not.toContain('LOYALTYCUST-');
      // (the ORD- order-number counter is fine — only customer counters must go)
      expect(read(f)).not.toContain('`CUST-${hotelId}`');
      expect(read(f)).not.toContain('`CUST-${req.hotelId}`');
    }
  });

  it('only a duplicate phone is reported as "phone already exists"', () => {
    expect(read('loyaltyRoutes.ts')).toContain('err.code === 11000 && err.keyPattern?.phone');
  });
});
