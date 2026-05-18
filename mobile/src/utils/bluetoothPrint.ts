import { Platform } from 'react-native';
import { cacheDirectory, downloadAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { Order, Settings } from '../types';
import { UPI_ID } from './constants';

// Download QR code image from API as base64 — works on all ESC/POS printers via printPic
const fetchQRBase64 = async (upiId: string, amount: string, sizePx: number): Promise<string> => {
  const upiStr = `upi://pay?pa=${upiId}&am=${amount}&cu=INR`;
  const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&format=png&data=${encodeURIComponent(upiStr)}`;
  const tempPath = `${cacheDirectory}receipt_qr.png`;
  const { uri } = await downloadAsync(apiUrl, tempPath);
  return await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
};

export const BT_PERMISSION_DENIED = 'BT_PERMISSION_DENIED';

// Load native modules directly — bypasses library's index.js which crashes
// if any of the three modules (BluetoothTscPrinter) is null
let BluetoothEscposPrinter: any = null;
let BluetoothManager: any = null;

try {
  const { NativeModules } = require('react-native');
  if (NativeModules.BluetoothManager) BluetoothManager = NativeModules.BluetoothManager;
  if (NativeModules.BluetoothEscposPrinter) BluetoothEscposPrinter = NativeModules.BluetoothEscposPrinter;
} catch {
  // native modules not available
}

export interface BluetoothDevice {
  name: string;
  address: string;
}

// Get paired Bluetooth devices — no upfront permission dialog.
// If the OS rejects the call (Android 12+ without permission), throws BT_PERMISSION_DENIED
// so the caller can show an "Open Settings" button.
export const getPairedDevices = async (): Promise<BluetoothDevice[]> => {
  if (!BluetoothManager) throw new Error('Bluetooth printing not available on this device');
  try {
    const paired = await BluetoothManager.enableBluetooth();
    const devices: BluetoothDevice[] = [];
    if (paired && paired.length > 0) {
      paired.forEach((d: any) => {
        try {
          const parsed = typeof d === 'string' ? JSON.parse(d) : d;
          devices.push({ name: parsed.name || 'Unknown', address: parsed.address });
        } catch {}
      });
    }
    return devices;
  } catch (e: any) {
    if (e.message && e.message.includes('BLUETOOTH_CONNECT')) {
      throw new Error(BT_PERMISSION_DENIED);
    }
    throw new Error('Failed to get paired devices: ' + (e.message || 'Unknown error'));
  }
};

// Connect to a printer by address
export const connectPrinter = async (address: string): Promise<void> => {
  if (!BluetoothManager) throw new Error('Bluetooth printing not available on this device');
  try {
    await BluetoothManager.connect(address);
  } catch (e: any) {
    if (e.message && e.message.includes('BLUETOOTH_CONNECT')) {
      throw new Error(BT_PERMISSION_DENIED);
    }
    throw e;
  }
};

// Print the receipt via Bluetooth ESC/POS
export const printReceiptBluetooth = async (
  order: Order,
  settings: Settings
): Promise<void> => {
  if (!BluetoothEscposPrinter) throw new Error('Bluetooth printing not available');

  const P = BluetoothEscposPrinter;
  const activeUpiId = settings.upiId || UPI_ID;

  const date = new Date(order.createdAt);
  const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  // Avoid locale AM/PM symbols (e.g. narrow-space + 'pm' in en-IN) — format manually
  const hh = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh % 12 || 12;
  const timeStr = `${hh12}:${mm} ${ampm}`;

  // 58mm = 32 chars, 80mm = 42 chars (conservative — some 80mm printers are 42, not 48)
  // Never use fonttype:1/bold — many printers switch to double-width causing overflow
  const W = settings.printerWidth === '58mm' ? 32 : 42;
  const divider  = '-'.repeat(W);
  const dividerH = '='.repeat(W);

  // DEBUG LINE — remove after fixing tablet alignment
  await P.printText(`W=${W} (${settings.printerWidth})\n`, {});

  // Use Rs. — ESC/POS printers use ASCII charset; ₹ renders as ?
  const cur = 'Rs.';

  // Strip non-ASCII chars so they don't corrupt line-length calculations
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '');

  // Center one line (already fits within W)
  const cLine = (text: string): string => {
    const t = clean(text);
    const pad = Math.max(0, Math.floor((W - t.length) / 2));
    return ' '.repeat(pad) + t;
  };

  // Word-wrap then center — handles text longer than W
  const cBlock = (text: string): string => {
    const t = clean(text);
    if (t.length <= W) return cLine(t) + '\n';
    const words = t.split(' ');
    const lines: string[] = [];
    let cur2 = '';
    for (const word of words) {
      const test = cur2 ? cur2 + ' ' + word : word;
      if (test.length <= W) {
        cur2 = test;
      } else {
        if (cur2) lines.push(cur2);
        cur2 = word.length > W ? word.substring(0, W) : word;
      }
    }
    if (cur2) lines.push(cur2);
    return lines.map(l => cLine(l)).join('\n') + '\n';
  };

  // Left + right on same line; overflow → right on next line right-aligned
  const row = (left: string, right: string): string => {
    const l = clean(left);
    const r = clean(right);
    const space = W - l.length - r.length;
    if (space < 1) {
      return l + '\n' + r.padStart(W);
    }
    return l + ' '.repeat(space) + r;
  };

  // ── HEADER ──────────────────────────────────────────────
  await P.printText(cBlock(settings.hotelName || 'Hotel'), {});
  if (settings.address)   await P.printText(cBlock(settings.address), {});
  if (settings.phone)     await P.printText(cLine('Ph: ' + settings.phone) + '\n', {});
  if (settings.gstNumber) await P.printText(cLine('GST: ' + settings.gstNumber) + '\n', {});
  await P.printText(divider + '\n', {});

  // ── BILL INFO ────────────────────────────────────────────
  await P.printText('Bill No: ' + clean(order.orderNumber) + '\n', {});
  await P.printText('Date   : ' + dateStr + ' ' + timeStr + '\n', {});
  if (order.tableNumber)  await P.printText('Table  : ' + clean(order.tableNumber) + '\n', {});
  if (order.customerName) await P.printText('Name   : ' + clean(order.customerName) + '\n', {});
  await P.printText(divider + '\n', {});

  // ── ITEMS HEADER ─────────────────────────────────────────
  // 3-column: name | qty | amt
  // 58mm(W=32): nameCol=18, qtyCol=4, amtCol=10
  // 80mm(W=42): nameCol=28, qtyCol=4, amtCol=10
  const amtCol  = 10;
  const qtyCol  = 4;
  const nameCol = W - qtyCol - amtCol;
  await P.printText(
    'Item'.padEnd(nameCol) + 'Qty'.padStart(qtyCol) + 'Amt'.padStart(amtCol) + '\n', {}
  );
  await P.printText(divider + '\n', {});

  // ── ITEMS ────────────────────────────────────────────────
  for (const item of order.items) {
    const rawName = clean(item.productName);
    const qty     = ('x' + item.quantity).padStart(qtyCol);
    const amt     = (cur + (item.price * item.quantity).toFixed(2)).padStart(amtCol);
    const name    = rawName.length > nameCol
      ? rawName.substring(0, nameCol - 1) + '.'
      : rawName.padEnd(nameCol);
    await P.printText(name + qty + amt + '\n', {});
  }
  await P.printText(divider + '\n', {});

  // ── TOTALS ───────────────────────────────────────────────
  await P.printText(row('Subtotal', cur + order.subtotal.toFixed(2)) + '\n', {});
  if (order.taxTotal > 0) {
    const taxPct = settings.defaultTaxPercent || 0;
    const taxLabel = taxPct > 0 ? 'GST (' + taxPct + '%)' : 'GST';
    await P.printText(row(taxLabel, cur + order.taxTotal.toFixed(2)) + '\n', {});
  }

  // GRAND TOTAL — use '=' dividers + plain text (no fonttype/bold to avoid double-width mode)
  await P.printText(dividerH + '\n', {});
  await P.printText(row('GRAND TOTAL', cur + order.grandTotal.toFixed(2)) + '\n', {});
  await P.printText(dividerH + '\n', {});

  // ── UPI QR ───────────────────────────────────────────────
  await P.printText('\n', {});
  await P.printText(cLine('=== Scan & Pay ===') + '\n', {});
  await P.printText('\n', {});
  try {
    // Fill paper width — left=0, width=full paper dot width minus tiny margin
    // This guarantees true centering regardless of how the printer interprets 'left'
    const paperDots = W === 32 ? 384 : 576;
    const qrPx     = paperDots - 8;          // 4-dot padding each side
    const base64   = await fetchQRBase64(activeUpiId, order.grandTotal.toFixed(2), qrPx);
    await P.printPic(base64, { width: qrPx, left: 4 });
    await P.printText('\n', {});
  } catch {
    await P.printText(cLine(activeUpiId) + '\n', {});
  }
  // UPI ID — wrap if longer than W
  await P.printText(cBlock('UPI: ' + activeUpiId), {});
  await P.printText(divider + '\n', {});

  // ── FOOTER ───────────────────────────────────────────────
  if (settings.footerText) {
    await P.printText(cBlock(settings.footerText), {});
  }

  // Paper feed and cut
  await P.printText('\n\n\n', {});
};
