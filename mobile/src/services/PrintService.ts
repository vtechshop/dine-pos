import { connectPrinter, printKOTBluetooth, printReceiptBluetooth } from '../utils/bluetoothPrint';
import type { Settings, KOTOrderInput, Order } from '../types';

// ── Payload types — mirror of backend printUtils.ts ────────────────────────────

export interface KOTPayload {
  templateType: 'kot';
  orderNumber:  string;
  tableNumber:  string;
  guestLabel?:  string;
  orderSource:  string;
  items:        { productName: string; quantity: number }[];
  notes?:       string;
  createdAt:    string;
}

export interface ReceiptPayload {
  templateType:          'receipt';
  hotelName:             string;
  address?:              string;
  phone?:                string;
  gstNumber?:            string;
  footerText?:           string;
  upiId?:                string;
  printerWidth:          '58mm' | '80mm';
  tableNumber:           string;
  guestLabel?:           string;
  paymentMethod:         string;
  items:                 { productName: string; quantity: number; price: number; total: number }[];
  subtotal:              number;
  taxTotal:              number;
  grandTotal:            number;
  loyaltyDiscountAmount?: number;
  defaultTaxPercent:     number;
  currencySymbol:        string;
  createdAt:             string;
}

export type PrintPayload = KOTPayload | ReceiptPayload;

export interface PrintJobEvent {
  jobId:          string;
  jobType:        'kot' | 'receipt';
  printerTarget:  'kitchen' | 'cashier';
  printerAddress: string;
  printerMode:    'single' | 'dual';
  payload:        PrintPayload;
}

// ── Driver interface — extensible for LAN/USB/WiFi/Cloud without redesign ───────

interface PrintDriver {
  printKOT(address: string, payload: KOTPayload, settings: Settings): Promise<void>;
  printReceipt(address: string, payload: ReceiptPayload, settings: Settings): Promise<void>;
}

// ── Bluetooth driver — wraps existing bluetoothPrint.ts functions ────────────────

class BluetoothPrintDriver implements PrintDriver {
  async printKOT(address: string, payload: KOTPayload, settings: Settings): Promise<void> {
    await connectPrinter(address);
    const kotInput: KOTOrderInput = {
      orderNumber: payload.orderNumber,
      tableNumber: payload.tableNumber,
      items:       payload.items,
      notes:       payload.notes || '',
      createdAt:   payload.createdAt,
    };
    await printKOTBluetooth(kotInput, settings);
  }

  async printReceipt(address: string, payload: ReceiptPayload, settings: Settings): Promise<void> {
    await connectPrinter(address);

    // Build a minimal Order-shaped object from the payload
    const mockOrder: Order = {
      _id:           '',
      orderNumber:   `RCPT-${payload.tableNumber}`,
      items:         payload.items.map(i => ({
        product:    '',
        productName: i.productName,
        quantity:    i.quantity,
        price:       i.price,
        taxPercent:  payload.defaultTaxPercent,
        taxAmount:   0,
        total:       i.total,
      })),
      subtotal:      payload.subtotal,
      taxTotal:      payload.taxTotal,
      discountAmount: payload.loyaltyDiscountAmount ?? 0,
      grandTotal:    payload.grandTotal,
      paymentMethod: payload.paymentMethod as Order['paymentMethod'],
      splitDetails:  {},
      status:        'completed',
      isParcel:      false,
      customerName:  payload.guestLabel || '',
      customerPhone: '',
      tableNumber:   payload.tableNumber,
      notes:         '',
      createdAt:     payload.createdAt,
      updatedAt:     payload.createdAt,
    };

    // Build a minimal Settings-shaped object from the payload
    const mockSettings: Settings = {
      ...settings,
      hotelName:        payload.hotelName,
      address:          payload.address   || '',
      phone:            payload.phone     || '',
      gstNumber:        payload.gstNumber || '',
      footerText:       payload.footerText || '',
      upiId:            payload.upiId     || '',
      printerWidth:     payload.printerWidth,
      currencySymbol:   payload.currencySymbol,
      defaultTaxPercent: payload.defaultTaxPercent,
    };

    await printReceiptBluetooth(mockOrder, mockSettings);
  }
}

// ── Driver registry — add 'lan' | 'usb' | 'wifi' | 'cloud' entries here later ──

const driverRegistry: Record<string, PrintDriver> = {
  bluetooth: new BluetoothPrintDriver(),
};

// ── Public: execute a print job event from the socket ──────────────────────────

export async function executePrintJob(
  event:         PrintJobEvent,
  settings:      Settings,
  reportStatus:  (jobId: string, status: 'success' | 'failed', error?: string) => Promise<void>,
): Promise<void> {
  const { jobId, printerAddress, payload } = event;

  if (!printerAddress) {
    await reportStatus(jobId, 'failed', 'No printer address in job');
    return;
  }

  const driver = driverRegistry['bluetooth'];
  if (!driver) {
    await reportStatus(jobId, 'failed', 'No print driver available');
    return;
  }

  try {
    if (payload.templateType === 'kot') {
      await driver.printKOT(printerAddress, payload as KOTPayload, settings);
    } else {
      await driver.printReceipt(printerAddress, payload as ReceiptPayload, settings);
    }
    await reportStatus(jobId, 'success');
  } catch (err: any) {
    const message = (err?.message || 'Unknown print error').slice(0, 300);
    await reportStatus(jobId, 'failed', message);
  }
}
