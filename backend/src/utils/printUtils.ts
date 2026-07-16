import mongoose from 'mongoose';
import Settings from '../models/Settings';
import Order from '../models/Order';
import PrintJob from '../models/PrintJob';
import { io } from '../server';
import { logger } from './logger';

// ── Payload types — shared verbatim with mobile via socket events ───────────────

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

// ── Internal: create job record and emit socket event if applicable ─────────────

async function dispatchPrintJob(
  hotelId:       string,
  jobType:       'kot' | 'receipt',
  printerTarget: 'kitchen' | 'cashier',
  printerAddress: string,
  printerMode:   'single' | 'dual',
  autoEmit:      boolean,
  payload:       PrintPayload,
  refs: { orderId?: string; guestId?: string; sessionId?: string },
): Promise<void> {
  const shouldEmit = autoEmit && !!printerAddress;

  const job = await PrintJob.create({
    hotelId:      new mongoose.Types.ObjectId(hotelId),
    jobType,
    printerTarget,
    printerAddress,
    printerMode,
    orderId:      refs.orderId   ? new mongoose.Types.ObjectId(refs.orderId)   : null,
    guestId:      refs.guestId   ? new mongoose.Types.ObjectId(refs.guestId)   : null,
    sessionId:    refs.sessionId ? new mongoose.Types.ObjectId(refs.sessionId) : null,
    payload,
    status:       shouldEmit ? 'sent' : 'pending',
    sentAt:       shouldEmit ? new Date() : null,
    attemptCount: shouldEmit ? 1 : 0,
  });

  if (shouldEmit) {
    io.to(`hotel_${hotelId}`).emit('print_job', {
      jobId: String(job._id),
      jobType,
      printerTarget,
      printerAddress,
      printerMode,
      payload,
    });
    logger.info('Print job dispatched', {
      hotelId,
      jobId:         String(job._id),
      jobType,
      printerTarget,
      printerMode,
      printerAddress,
    });
  } else {
    logger.info('Print job queued as pending', {
      hotelId,
      jobId:          String(job._id),
      jobType,
      printerAddress: printerAddress || '(none)',
    });
  }
}

// ── Public: schedule KOT print after order creation ─────────────────────────────

export async function scheduleKOTPrint(
  hotelId: string,
  order: {
    _id:         any;
    orderNumber: string;
    tableNumber?: string;
    customerName?: string;
    items:       { productName: string; quantity: number }[];
    notes?:      string;
    orderSource?: string;
    createdAt:   Date | string;
    sessionId?:  any;
    guestId?:    any;
  },
): Promise<void> {
  const settings = await Settings.findOne({ hotelId: new mongoose.Types.ObjectId(hotelId) })
    .select('printerMode kitchenPrinterAddress kotAutoPrint')
    .lean();

  const s           = settings as any;
  const mode        = s?.printerMode           ?? 'single';
  const kotAddress  = s?.kitchenPrinterAddress ?? '';
  const kotAutoPrint = s?.kotAutoPrint         ?? false;

  const payload: KOTPayload = {
    templateType: 'kot',
    orderNumber:  order.orderNumber,
    tableNumber:  order.tableNumber ?? '',
    guestLabel:   order.customerName || undefined,
    orderSource:  order.orderSource  ?? 'admin',
    items:        order.items.map(i => ({ productName: i.productName, quantity: i.quantity })),
    notes:        order.notes || undefined,
    createdAt:    order.createdAt instanceof Date
      ? order.createdAt.toISOString()
      : (order.createdAt ?? new Date().toISOString()),
  };

  await dispatchPrintJob(
    hotelId,
    'kot',
    'kitchen',
    kotAddress,
    mode,
    kotAutoPrint,
    payload,
    {
      orderId:   String(order._id),
      guestId:   order.guestId   ? String(order.guestId)   : undefined,
      sessionId: order.sessionId ? String(order.sessionId) : undefined,
    },
  );
}

// ── Public: schedule Receipt print after guest billing ──────────────────────────

export interface ReceiptPrintInput {
  guestId:                string;
  sessionId?:             string;
  tableNumber:            string;
  guestLabel:             string;
  totalAmount:            number;
  paymentMethod:          string;
  loyaltyDiscountAmount?: number;
}

export async function scheduleReceiptPrint(
  hotelId: string,
  input:   ReceiptPrintInput,
): Promise<void> {
  const [settings, orders] = await Promise.all([
    Settings.findOne({ hotelId: new mongoose.Types.ObjectId(hotelId) })
      .select('printerMode kitchenPrinterAddress cashierPrinterAddress hotelName address phone gstNumber footerText upiId printerWidth defaultTaxPercent currencySymbol')
      .lean(),
    Order.find({
      guestId: new mongoose.Types.ObjectId(input.guestId),
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select('items subtotal taxTotal grandTotal').lean(),
  ]);

  const s              = settings as any;
  const mode           = s?.printerMode            ?? 'single';
  const kitchenAddr    = s?.kitchenPrinterAddress  ?? '';
  const cashierAddr    = s?.cashierPrinterAddress  ?? '';
  const printerAddress = mode === 'dual' ? cashierAddr : kitchenAddr;

  let subtotal = 0;
  let taxTotal = 0;
  const items: ReceiptPayload['items'] = [];
  for (const o of (orders as any[])) {
    subtotal += Number(o.subtotal) || 0;
    taxTotal += Number(o.taxTotal) || 0;
    for (const item of (o.items || [])) {
      items.push({
        productName: item.productName,
        quantity:    item.quantity,
        price:       item.price,
        total:       item.total,
      });
    }
  }

  const payload: ReceiptPayload = {
    templateType:          'receipt',
    hotelName:             s?.hotelName          ?? 'Hotel',
    address:               s?.address            || undefined,
    phone:                 s?.phone              || undefined,
    gstNumber:             s?.gstNumber          || undefined,
    footerText:            s?.footerText         || undefined,
    upiId:                 s?.upiId              || undefined,
    printerWidth:          (s?.printerWidth      ?? '80mm') as '58mm' | '80mm',
    tableNumber:           input.tableNumber,
    guestLabel:            input.guestLabel,
    paymentMethod:         input.paymentMethod,
    items,
    subtotal:              +subtotal.toFixed(2),
    taxTotal:              +taxTotal.toFixed(2),
    grandTotal:            +input.totalAmount.toFixed(2),
    loyaltyDiscountAmount: input.loyaltyDiscountAmount || undefined,
    defaultTaxPercent:     s?.defaultTaxPercent  ?? 5,
    currencySymbol:        s?.currencySymbol      ?? '₹',
    createdAt:             new Date().toISOString(),
  };

  await dispatchPrintJob(
    hotelId,
    'receipt',
    'cashier',
    printerAddress,
    mode,
    true,
    payload,
    {
      guestId:   input.guestId,
      sessionId: input.sessionId,
    },
  );
}
