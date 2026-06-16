import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Order, Settings, KOTOrderInput } from '../types';
import { UPI_ID, UPI_NAME } from './constants';
import { printReceiptBluetooth, printKOTBluetooth, connectPrinter } from './bluetoothPrint';

const BT_PRINTER_KEY = '@hotel_pos_bt_printer';
const BT_PRINTER_ADDRESS_KEY = '@hotel_pos_bt_printer_address';

// mm to points (1pt = 0.3528mm)
const mmToPt = (mm: number) => Math.round(mm / 0.3528);

// Exact thermal paper widths in points: 58mm→164pt, 80mm→227pt
const getThermalWidth = (printerWidth: string) =>
  printerWidth === '58mm' ? mmToPt(58) : mmToPt(80);

// Generate receipt HTML for printing
export const generateReceiptHTML = (order: Order, settings: Settings): string => {
  const isWeb = Platform.OS === 'web';
  const is58mm = settings.printerWidth === '58mm';

  // Body width: web uses full width, mobile uses exact thermal column width
  const receiptWidth = isWeb ? '100%' : is58mm ? '48mm' : '72mm';

  // Font sizes scaled per output target (px values render at 96dpi in WebKit)
  const fs = isWeb
    ? { base: 16, title: 24, info: 14, bill: 15, th: 15, td: 15, total: 16, grand: 22, payment: 15, footer: 14, qrLabel: 13, qrSub: 12 }
    : is58mm
    ? { base: 9,  title: 12, info: 8,  bill: 9,  th: 8,  td: 8,  total: 9,  grand: 11, payment: 9,  footer: 8,  qrLabel: 8,  qrSub: 7  }
    : { base: 11, title: 15, info: 10, bill: 11, th: 10, td: 10, total: 11, grand: 14, payment: 11, footer: 10, qrLabel: 10, qrSub: 9  };

  // QR size in px — proportional to column width
  const qrSize = isWeb ? 160 : is58mm ? 100 : 130;

  const itemRows = order.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left; padding:3px 2px;">${item.productName}</td>
        <td style="text-align:center; padding:3px 2px;">${item.quantity}</td>
        <td style="text-align:right; padding:3px 2px;">${settings.currencySymbol}${item.price.toFixed(2)}</td>
        <td style="text-align:right; padding:3px 2px;">${settings.currencySymbol}${(item.price * item.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const date = new Date(order.createdAt);
  const dateStr = date.toLocaleDateString('en-IN');
  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // UPI QR — amount pre-filled so customer just scans and pays
  const activeUpiId = settings.upiId || UPI_ID;
  const upiString = `upi://pay?pa=${activeUpiId}&pn=${encodeURIComponent(settings.hotelName || UPI_NAME)}&am=${order.grandTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + order.orderNumber)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&format=png&data=${encodeURIComponent(upiString)}`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=${isWeb ? 220 : is58mm ? 164 : 227}, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>
      @page {
        size: ${isWeb ? '58mm auto' : `${settings.printerWidth} auto`};
        margin: 0;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { width: ${isWeb ? '100%' : is58mm ? '164px' : '227px'}; }
      body {
        font-family: 'Courier New', 'Lucida Console', monospace;
        width: ${isWeb ? '100%' : is58mm ? '164px' : '227px'};
        max-width: ${isWeb ? '100%' : is58mm ? '164px' : '227px'};
        margin: 0;
        padding: 4px;
        font-size: ${fs.base}px;
        color: #000;
        background: #fff;
        overflow: hidden;
      }
      .hotel-name {
        text-align: center;
        font-weight: bold;
        font-size: ${fs.title}px;
        margin-bottom: 3px;
      }
      .hotel-info {
        text-align: center;
        font-size: ${fs.info}px;
        color: #333;
        margin-bottom: 2px;
      }
      .line {
        border: none;
        border-top: 1px dashed #000;
        margin: 6px 0;
      }
      .bill-info {
        font-size: ${fs.bill}px;
        margin-bottom: 2px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        text-align: left;
        font-size: ${fs.th}px;
        padding: 4px 2px;
        border-bottom: 1px solid #000;
        font-weight: bold;
      }
      td {
        font-size: ${fs.td}px;
        padding: 3px 2px;
      }
      .totals-table td {
        padding: 3px 2px;
        font-size: ${fs.total}px;
      }
      .grand-total td {
        font-size: ${fs.grand}px;
        font-weight: bold;
        padding-top: 5px;
        border-top: 1px solid #000;
      }
      .payment-method {
        font-size: ${fs.payment}px;
        margin: 4px 0;
      }
      .qr-section {
        text-align: center;
        margin: 8px 0 3px;
      }
      .qr-section img {
        width: ${qrSize}px;
        height: ${qrSize}px;
      }
      .qr-label {
        text-align: center;
        font-size: ${fs.qrLabel}px;
        font-weight: bold;
        color: #000;
        margin-bottom: 2px;
      }
      .qr-sublabel {
        text-align: center;
        font-size: ${fs.qrSub}px;
        color: #555;
        margin-bottom: 4px;
      }
      .footer {
        text-align: center;
        font-size: ${fs.footer}px;
        margin-top: 6px;
        color: #555;
      }
    </style>
  </head>
  <body>
    <div class="hotel-name">${settings.hotelName}</div>
    ${settings.address ? `<div class="hotel-info">${settings.address}</div>` : ''}
    ${settings.phone ? `<div class="hotel-info">Ph: ${settings.phone}</div>` : ''}
    ${settings.gstNumber ? `<div class="hotel-info">GST: ${settings.gstNumber}</div>` : ''}

    <hr class="line">

    <div class="bill-info"><strong>Bill No:</strong> ${order.orderNumber}</div>
    <div class="bill-info"><strong>Date:</strong> ${dateStr} | ${timeStr}</div>
    ${order.tableNumber ? `<div class="bill-info"><strong>Table:</strong> ${order.tableNumber}</div>` : ''}
    ${order.customerName ? `<div class="bill-info"><strong>Customer:</strong> ${order.customerName}</div>` : ''}

    <hr class="line">

    <table>
      <thead>
        <tr>
          <th style="text-align:left; width:40%;">Item</th>
          <th style="text-align:center; width:15%;">Qty</th>
          <th style="text-align:right; width:20%;">Rate</th>
          <th style="text-align:right; width:25%;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <hr class="line">

    <table class="totals-table">
      <tr>
        <td style="text-align:left;">Subtotal</td>
        <td style="text-align:right;">${settings.currencySymbol}${order.subtotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="text-align:left;">GST</td>
        <td style="text-align:right;">${settings.currencySymbol}${order.taxTotal.toFixed(2)}</td>
      </tr>
      <tr class="grand-total">
        <td style="text-align:left;">GRAND TOTAL</td>
        <td style="text-align:right;">${settings.currencySymbol}${order.grandTotal.toFixed(2)}</td>
      </tr>
    </table>

    <hr class="line">

    <div class="payment-method"><strong>Payment:</strong> ${order.paymentMethod.toUpperCase()}</div>

    <hr class="line">

    <div class="qr-section">
      <img src="${qrUrl}" alt="UPI QR" />
    </div>
    <div class="qr-label">Scan to Pay ${settings.currencySymbol}${order.grandTotal.toFixed(2)}</div>
    <div class="qr-sublabel">UPI: ${activeUpiId}</div>

    <hr class="line">

    <div class="footer">${settings.footerText}</div>
  </body>
</html>`;
};

// Print receipt — uses Bluetooth if printer is paired, else generates
// a correctly-sized PDF and opens the share sheet so it can be sent
// directly to a thermal printer app (bypasses Android's "Letter" default).
export const printReceipt = async (
  order: Order,
  settings: Settings
): Promise<void> => {
  if (Platform.OS === 'web') {
    const html = generateReceiptHTML(order, settings);
    const printWindow = window.open('', '_blank', 'width=450,height=700');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
    }
    return;
  }

  // Bluetooth printer paired → reconnect + print via ESC/POS
  const savedPrinter = await AsyncStorage.getItem(BT_PRINTER_KEY);
  if (savedPrinter) {
    const savedAddress = await AsyncStorage.getItem(BT_PRINTER_ADDRESS_KEY);
    if (savedAddress) {
      await connectPrinter(savedAddress);
    }
    await printReceiptBluetooth(order, settings);
    return;
  }

  const html = generateReceiptHTML(order, settings);
  // Exact thermal paper width in points (1pt = 0.3528mm)
  const pageWidth = getThermalWidth(settings.printerWidth);

  // printToFileAsync respects width + @page CSS → creates a proper thermal-sized PDF.
  // Sharing via the native share sheet lets the user open it in any printer app
  // (RawBT, Mobile Receipt Printer, etc.) without the Android "Letter" override.
  // Pass explicit width+height so tablet WebView renders at the same scale as phone.
  const { uri } = await Print.printToFileAsync({ html, width: pageWidth, height: pageWidth * 10 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Print Receipt',
    });
  } else {
    // Fallback: open system print dialog with correct width
    await Print.printAsync({ html, width: pageWidth });
  }
};

// Generate kitchen ticket (KOT) HTML — item + qty only, no prices/tax
export const generateKOTHTML = (order: KOTOrderInput, settings: Settings): string => {
  const isWeb = Platform.OS === 'web';
  const is58mm = settings.printerWidth === '58mm';

  const fs = isWeb
    ? { title: 22, info: 15, item: 20 }
    : is58mm
    ? { title: 14, info: 10, item: 13 }
    : { title: 17, info: 12, item: 15 };

  const itemRows = order.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left; padding:5px 2px; font-weight:bold;">${item.productName}</td>
        <td style="text-align:right; padding:5px 2px; font-weight:bold;">x${item.quantity}</td>
      </tr>`
    )
    .join('');

  const date = new Date(order.createdAt);
  const dateStr = date.toLocaleDateString('en-IN');
  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: ${isWeb ? '58mm auto' : `${settings.printerWidth} auto`}; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Courier New', 'Lucida Console', monospace;
        width: ${isWeb ? '100%' : is58mm ? '164px' : '227px'};
        padding: 6px; color: #000; background: #fff;
      }
      .kot-title { text-align: center; font-weight: 900; font-size: ${fs.title}px; border: 2px solid #000; padding: 4px; margin-bottom: 6px; }
      .info { font-size: ${fs.info}px; margin-bottom: 3px; font-weight: bold; }
      .line { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { font-size: ${fs.item}px; padding: 5px 2px; }
      .notes { font-size: ${fs.info}px; margin-top: 6px; font-style: italic; border: 1px solid #000; padding: 4px; }
    </style>
  </head>
  <body>
    <div class="kot-title">KITCHEN ORDER</div>
    <div class="info">Order: ${order.orderNumber}</div>
    ${order.tableNumber ? `<div class="info">Table: ${order.tableNumber}</div>` : ''}
    <div class="info">Time: ${dateStr} ${timeStr}</div>
    <hr class="line">
    <table><tbody>${itemRows}</tbody></table>
    <hr class="line">
    ${order.notes ? `<div class="notes">Note: ${order.notes}</div>` : ''}
  </body>
</html>`;
};

// Print KOT — uses Bluetooth if printer is paired, else generates a
// thermal-sized PDF and opens the share sheet (can target a separate kitchen printer app)
export const printKOT = async (
  order: KOTOrderInput,
  settings: Settings
): Promise<void> => {
  if (Platform.OS === 'web') {
    const html = generateKOTHTML(order, settings);
    const printWindow = window.open('', '_blank', 'width=450,height=700');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
    }
    return;
  }

  const savedPrinter = await AsyncStorage.getItem(BT_PRINTER_KEY);
  if (savedPrinter) {
    const savedAddress = await AsyncStorage.getItem(BT_PRINTER_ADDRESS_KEY);
    if (savedAddress) {
      await connectPrinter(savedAddress);
    }
    await printKOTBluetooth(order, settings);
    return;
  }

  const html = generateKOTHTML(order, settings);
  const pageWidth = getThermalWidth(settings.printerWidth);
  const { uri } = await Print.printToFileAsync({ html, width: pageWidth, height: pageWidth * 6 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Print KOT',
    });
  } else {
    await Print.printAsync({ html, width: pageWidth });
  }
};

// Share receipt as PDF (e.g. WhatsApp, email)
export const shareReceipt = async (
  order: Order,
  settings: Settings
): Promise<void> => {
  const html = generateReceiptHTML(order, settings);
  const pageWidth = getThermalWidth(settings.printerWidth);
  const { uri } = await Print.printToFileAsync({ html, width: pageWidth });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share Receipt',
    });
  }
};
