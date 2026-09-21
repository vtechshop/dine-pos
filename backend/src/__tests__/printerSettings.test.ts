/**
 * PRINTER SETTINGS REGRESSION TESTS
 *
 * Test IDs: PRINTER-SETTING-01, PRINTER-SETTING-03
 *
 * PRINTER-SETTING-01: Static assertion that no startup migration exists in server.ts
 *                     that force-sets kotAutoPrint to true.
 *
 * PRINTER-SETTING-03: Functional assertion that single mode is safe even when a DB
 *                     document has kotAutoPrint=true (legacy value).
 *
 * All module tests are pure unit tests — no real DB, no real sockets.
 */

// ─── Module mocks (hoisted by Jest before any import) ────────────────────────

jest.mock('../models/Settings');
jest.mock('../models/PrintJob');
jest.mock('../models/PrinterDevice');
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../server', () => ({
  io: {
    sockets: { sockets: { has: jest.fn().mockReturnValue(false) } },
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';

import Settings      from '../models/Settings';
import PrintJob      from '../models/PrintJob';
import PrinterDevice from '../models/PrinterDevice';
import { scheduleKOTPrint } from '../utils/printUtils';

// ─────────────────────────────────────────────────────────────────────────────
// PRINTER-SETTING-01: Static — no kotAutoPrint migration in server startup
// ─────────────────────────────────────────────────────────────────────────────

describe('PRINTER-SETTING-01: server.ts startup must not contain a kotAutoPrint force-migration', () => {
  let serverSource: string;

  beforeAll(() => {
    // Read server.ts source for static analysis
    const serverPath = path.join(__dirname, '../server.ts');
    serverSource = fs.readFileSync(serverPath, 'utf-8');
  });

  it('server.ts has no updateMany call that touches kotAutoPrint', () => {
    // Pattern that was present before removal:
    //   Settings.updateMany({ kotAutoPrint: { $ne: true } }, { $set: { kotAutoPrint: true } })
    expect(serverSource).not.toMatch(/updateMany[\s\S]{0,300}kotAutoPrint/);
  });

  it('server.ts has no $ne: true guard on kotAutoPrint', () => {
    expect(serverSource).not.toMatch(/kotAutoPrint[\s\S]{0,50}\$ne[\s\S]{0,50}true/);
  });

  it('server.ts has no $set: { kotAutoPrint: true } forced migration', () => {
    expect(serverSource).not.toMatch(/\$set[\s\S]{0,50}kotAutoPrint[\s\S]{0,20}true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRINTER-SETTING-03: Functional — single mode is safe with legacy kotAutoPrint=true
// ─────────────────────────────────────────────────────────────────────────────

describe('PRINTER-SETTING-03: single mode ignores kotAutoPrint=true (legacy DB value from old migration)', () => {
  const HOTEL_ID    = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const legacyOrder = {
    _id:         'eeeeeeeeeeeeeeeeeeeeeeee',
    orderNumber: 'ORD-LEGACY',
    tableNumber: 'T9',
    customerName: 'Legacy Guest',
    items:       [{ productName: 'Idli Sambar', quantity: 3 }],
    createdAt:   new Date('2024-01-15T09:00:00Z'),
    orderSource: 'dine-in',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (PrinterDevice.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    (PrinterDevice.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
  });

  it('printerMode=single with kotAutoPrint=true → PrintJob.create is never called', async () => {
    // Simulates a hotel whose DB has kotAutoPrint=true (from the now-removed migration)
    // but is operating in single printer mode. No KOT should be printed.
    (Settings.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          printerMode:           'single',
          kotAutoPrint:          true,   // ← legacy value from old migration
          kitchenPrinterAddress: 'BT:LEGACY:AA:BB:CC:DD',
          cashierPrinterAddress: '',
        }),
      }),
    });

    await scheduleKOTPrint(HOTEL_ID, legacyOrder);

    expect(PrintJob.create).not.toHaveBeenCalled();
  });

  it('printerMode=single with kotAutoPrint=true → printerMode is the only deciding factor', async () => {
    // Confirms the invariant: printerMode takes absolute precedence over kotAutoPrint.
    // Whether kotAutoPrint is true or false does not matter when mode is single.
    (Settings.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          printerMode:           'single',
          kotAutoPrint:          true,
          kitchenPrinterAddress: 'BT:11:22:33:44:55:66',
          cashierPrinterAddress: 'BT:77:88:99:AA:BB:CC',
        }),
      }),
    });

    await scheduleKOTPrint(HOTEL_ID, legacyOrder);

    expect(PrintJob.create).not.toHaveBeenCalled();
  });
});
