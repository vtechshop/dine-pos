import { PermissionsAndroid, Platform } from 'react-native';
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

// Request Android Bluetooth runtime permissions.
// Returns true only when both permissions are fully GRANTED.
// Throws BT_PERMISSION_DENIED when denied or permanently denied so the
// caller can open Settings instead of showing a confusing error.
const requestBluetoothPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;

  const version = typeof Platform.Version === 'string'
    ? parseInt(Platform.Version, 10)
    : Platform.Version;

  if (version < 31) return true;

  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);

    const connectGranted = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
    const scanGranted    = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]    === PermissionsAndroid.RESULTS.GRANTED;

    if (!connectGranted || !scanGranted) {
      throw new Error(BT_PERMISSION_DENIED);
    }
    return true;
  } catch (e: any) {
    throw e;
  }
};

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

// Get paired Bluetooth devices
export const getPairedDevices = async (): Promise<BluetoothDevice[]> => {
  if (!BluetoothManager) throw new Error('Bluetooth printing not available');

  const hasPermission = await requestBluetoothPermissions();
  if (!hasPermission) throw new Error('Bluetooth permission denied. Go to Settings → Apps → Dine POS → Permissions → Nearby devices → Allow. Then FORCE CLOSE this app and reopen it.');

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
    throw new Error('Failed to get paired devices: ' + e.message);
  }
};

// Connect to a printer by address
export const connectPrinter = async (address: string): Promise<void> => {
  if (!BluetoothManager) throw new Error('Bluetooth printing not available');
  const hasPermission = await requestBluetoothPermissions();
  if (!hasPermission) throw new Error('Bluetooth permission denied.');
  await BluetoothManager.connect(address);
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
  // 58mm(W=32): nameCol=18, qtyCol=4, amtCol=10  → 18+4+10=32 ✓
  // 80mm(W=42): nameCol=28, qtyCol=4, amtCol=10  → 28+4+10=42 ✓
  const amtCol  = 10;
  const qtyCol  = 4;
  const nameCol = W - qtyCol - amtCol;
  await P.printText(
    'Item'.padEnd(nameCol) + 'Qty'.padStart(qtyCol) + 'Amt'.padStart(amtCol) + '\n',
    {}
  );
  await P.printText(divider + '\n', {});

  // ── ITEMS ────────────────────────────────────────────────
  for (const item of order.items) {
    // Format amount without "Rs." prefix to save space on narrow paper
    const amt = cur + (item.price * item.quantity).toFixed(2);
    const qty = 'x' + item.quantity;
    const rawName = clean(item.productName);
    const name = rawName.length > nameCol
      ? rawName.substring(0, nameCol - 1) + '.'
      : rawName.padEnd(nameCol);
    // If amount is too long (e.g. Rs.10000.00 = 10 chars), trim cur prefix
    const amtStr = amt.length <= amtCol ? amt.padStart(amtCol) : amt.padStart(amt.length);
    await P.printText(name + qty.padStart(qtyCol) + amtStr + '\n', {});
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
  // Fetch QR as PNG from API → print as bitmap (works on all ESC/POS printers)
  await P.printText(cLine('Scan & Pay') + '\n', {});
  try {
    // Large QR — fills most of the paper width for easy scanning
    const qrPx = W === 32 ? 280 : 350;
    const base64 = await fetchQRBase64(activeUpiId, order.grandTotal.toFixed(2), qrPx);
    // Paper usable dot width: 58mm ≈ 384 dots, 80mm ≈ 576 dots (at 8 dots/mm)
    const paperDots = W === 32 ? 384 : 576;
    const leftMargin = Math.max(0, Math.floor((paperDots - qrPx) / 2));
    await P.printPic(base64, { width: qrPx, left: leftMargin });
    await P.printText('\n', {});
  } catch {
    // No internet or printer doesn't support bitmap — show UPI text
    await P.printText(cLine(activeUpiId) + '\n', {});
  }
  await P.printText(cLine('UPI: ' + activeUpiId) + '\n', {});
  await P.printText(divider + '\n', {});

  // ── FOOTER ───────────────────────────────────────────────
  if (settings.footerText) {
    await P.printText(cBlock(settings.footerText), {});
  }

  // Paper feed and cut
  await P.printText('\n\n\n', {});
};
