/**
 * PRINTER SINGLE-MODE REGRESSION TESTS
 *
 * Business rule (non-negotiable):
 *   SINGLE printer mode → NEVER print KOT. Receipt only.
 *   DUAL printer mode   → KOT to kitchen printer, receipt to cashier printer.
 *
 * Test IDs: PRINTER-SINGLE-01, 02, 03, 05, 06 | PRINTER-DUAL-01, 02
 *
 * All tests are pure unit tests — no real DB, no real sockets.
 * Mocks: Settings.findOne, PrintJob.create, PrinterDevice.findOne, io
 */

// ─── Module mocks (hoisted by Jest before any import) ────────────────────────

jest.mock('../models/Settings');
jest.mock('../models/PrintJob');
jest.mock('../models/PrinterDevice');
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// Prevent server.ts from running; provide a minimal io stub.
jest.mock('../server', () => ({
  io: {
    sockets: { sockets: { has: jest.fn().mockReturnValue(false) } },
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  },
}));

// ─── Imports (resolved after mocks are in place) ──────────────────────────────

import Settings from '../models/Settings';
import PrintJob from '../models/PrintJob';
import PrinterDevice from '../models/PrinterDevice';
import { scheduleKOTPrint, scheduleOrderReceiptPrint } from '../utils/printUtils';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOTEL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // 24-char hex — valid ObjectId

const sampleKOTOrder = {
  _id:         'bbbbbbbbbbbbbbbbbbbbbbbb',
  orderNumber: 'ORD-001',
  tableNumber: 'T1',
  customerName: 'Ravi Kumar',
  items:       [{ productName: 'Paneer Butter Masala', quantity: 2 }],
  notes:       'Extra spicy',
  orderSource: 'dine-in',
  createdAt:   new Date('2024-06-01T10:00:00Z'),
};

const sampleReceiptOrder = {
  _id:           'cccccccccccccccccccccccc',
  orderNumber:   'ORD-002',
  tableNumber:   'T2',
  customerName:  'Priya Sharma',
  orderSource:   'dine-in',
  paymentMethod: 'cash',
  items: [{ productName: 'Masala Dosa', quantity: 1, price: 80, total: 80 }],
  subtotal:      80,
  taxTotal:       4,
  grandTotal:    84,
  discountAmount: 0,
  createdAt:     new Date('2024-06-01T11:00:00Z'),
};

const singleModeSettingsBase = {
  printerMode:            'single',
  kitchenPrinterAddress:  'BT:AA:BB:CC:DD:EE',
  cashierPrinterAddress:  '',
  kotAutoPrint:           false,
  hotelName:              'Test Hotel',
  printerWidth:           '80mm',
  defaultTaxPercent:      5,
  currencySymbol:         '₹',
};

const dualModeSettingsBase = {
  printerMode:            'dual',
  kitchenPrinterAddress:  'BT:KIT:01:02:03:04',
  cashierPrinterAddress:  'BT:CASH:05:06:07:08',
  kotAutoPrint:           true,
  hotelName:              'Dual Hotel',
  printerWidth:           '80mm',
  defaultTaxPercent:      5,
  currencySymbol:         '₹',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Set up Settings.findOne().select().lean() chain mock */
function setupSettings(data: Record<string, any> | null) {
  (Settings.findOne as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(data),
    }),
  });
}

/** Set up PrinterDevice.findOne().select().lean() chain mock */
function setupDevice(device: Record<string, any> | null) {
  (PrinterDevice.findOne as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(device),
    }),
  });
  // findOneAndUpdate is fire-and-forget (.catch(() => {})) — must return a Promise
  (PrinterDevice.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE MODE — KOT must never be created
// ─────────────────────────────────────────────────────────────────────────────

describe('PRINTER-SINGLE: KOT suppression in single printer mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDevice(null); // no printer device registered
  });

  it('PRINTER-SINGLE-01: scheduleKOTPrint never calls dispatchPrintJob — PrintJob.create is not called', async () => {
    setupSettings({ ...singleModeSettingsBase, kotAutoPrint: false });

    await scheduleKOTPrint(HOTEL_ID, sampleKOTOrder);

    expect(PrintJob.create).not.toHaveBeenCalled();
  });

  it('PRINTER-SINGLE-02: no PrintJob regardless of printer addresses being configured', async () => {
    setupSettings({
      ...singleModeSettingsBase,
      kitchenPrinterAddress: 'BT:AA:11:22:33:44',
      cashierPrinterAddress: 'BT:BB:55:66:77:88',
      kotAutoPrint: false,
    });

    await scheduleKOTPrint(HOTEL_ID, sampleKOTOrder);

    expect(PrintJob.create).not.toHaveBeenCalled();
  });

  it('PRINTER-SINGLE-03: legacy kotAutoPrint=true in DB — single mode still suppresses KOT', async () => {
    // This covers the case where the old startup migration had set kotAutoPrint=true.
    // Single mode printerMode must override kotAutoPrint entirely.
    setupSettings({ ...singleModeSettingsBase, kotAutoPrint: true });

    await scheduleKOTPrint(HOTEL_ID, sampleKOTOrder);

    expect(PrintJob.create).not.toHaveBeenCalled();
  });

  it('PRINTER-SINGLE-05: scheduleOrderReceiptPrint creates a PrintJob (audit trail) in single mode', async () => {
    setupSettings({ ...singleModeSettingsBase });
    (PrintJob.create as jest.Mock).mockResolvedValue({ _id: 'job_rcpt_single_1' });

    await scheduleOrderReceiptPrint(HOTEL_ID, sampleReceiptOrder);

    expect(PrintJob.create).toHaveBeenCalledTimes(1);
    const arg = (PrintJob.create as jest.Mock).mock.calls[0][0];
    expect(arg.jobType).toBe('receipt');
    expect(arg.printerTarget).toBe('cashier');
  });

  it('PRINTER-SINGLE-06: single-mode receipt PrintJob has status=pending and autoEmit=false (sentAt null, attemptCount 0)', async () => {
    // Single mode creates a receipt PrintJob for audit trail but does NOT socket-dispatch
    // (autoEmit=false → status=pending, sentAt=null, attemptCount=0)
    setupSettings({ ...singleModeSettingsBase });
    (PrintJob.create as jest.Mock).mockResolvedValue({ _id: 'job_rcpt_single_2' });

    await scheduleOrderReceiptPrint(HOTEL_ID, sampleReceiptOrder);

    const arg = (PrintJob.create as jest.Mock).mock.calls[0][0];
    expect(arg.status).toBe('pending');
    expect(arg.sentAt).toBeNull();
    expect(arg.attemptCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DUAL MODE — KOT to kitchen, receipt to cashier
// ─────────────────────────────────────────────────────────────────────────────

describe('PRINTER-DUAL: KOT and receipt routing in dual printer mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Printer offline — PrintJob is still created (status=pending), which is what we verify
    setupDevice(null);
  });

  it('PRINTER-DUAL-01: scheduleKOTPrint creates a PrintJob targeting the kitchen printer', async () => {
    setupSettings({ ...dualModeSettingsBase });
    (PrintJob.create as jest.Mock).mockResolvedValue({ _id: 'job_kot_dual_1' });

    await scheduleKOTPrint(HOTEL_ID, sampleKOTOrder);

    expect(PrintJob.create).toHaveBeenCalledTimes(1);
    const arg = (PrintJob.create as jest.Mock).mock.calls[0][0];
    expect(arg.printerTarget).toBe('kitchen');
    expect(arg.jobType).toBe('kot');
    expect(arg.printerMode).toBe('dual');
  });

  it('PRINTER-DUAL-02: scheduleOrderReceiptPrint creates a PrintJob targeting the cashier printer', async () => {
    setupSettings({ ...dualModeSettingsBase });
    (PrintJob.create as jest.Mock).mockResolvedValue({ _id: 'job_rcpt_dual_1' });

    await scheduleOrderReceiptPrint(HOTEL_ID, sampleReceiptOrder);

    expect(PrintJob.create).toHaveBeenCalledTimes(1);
    const arg = (PrintJob.create as jest.Mock).mock.calls[0][0];
    expect(arg.printerTarget).toBe('cashier');
    expect(arg.jobType).toBe('receipt');
    expect(arg.printerMode).toBe('dual');
  });
});
