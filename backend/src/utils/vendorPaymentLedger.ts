// Phase 5 · Batch 6 (P4-INV-07): one way to record money paid to a vendor — the payment, the lower
// amount owed and the ledger credit. Moved unchanged from POST /vendor-payments so that marking a
// purchase invoice "Paid" records the payment too (it only changed the invoice status, and the
// vendor kept showing the amount as owed). Must run inside the caller's transaction.
import mongoose from 'mongoose';
import Vendor from '../models/Vendor';
import VendorPayment from '../models/VendorPayment';
import VendorLedgerEntry from '../models/VendorLedgerEntry';

export const VENDOR_PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'] as const;

export interface VendorPaymentInput {
  hotelId:         mongoose.Types.ObjectId;
  vendor:          { _id: mongoose.Types.ObjectId; businessName: string; vendorCode: string; mobile: string };
  paymentNumber:   string;
  paymentDate:     Date;
  paymentMethod:   string;
  amount:          number;
  referenceNumber: string;
  notes:           string;
  attachment:      string;
  createdBy:       string;
  idempotencyKey?: string;
}

export async function recordVendorPayment(p: VendorPaymentInput, session: mongoose.ClientSession) {
  const [payment] = await VendorPayment.create([{
    hotelId:         p.hotelId,
    paymentNumber:   p.paymentNumber,
    vendorId:        p.vendor._id,
    vendorSnapshot:  { businessName: p.vendor.businessName, vendorCode: p.vendor.vendorCode, mobile: p.vendor.mobile },
    paymentDate:     p.paymentDate,
    paymentMethod:   p.paymentMethod,
    amount:          p.amount,
    referenceNumber: p.referenceNumber,
    notes:           p.notes,
    attachment:      p.attachment,
    createdBy:       p.createdBy,
    ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
  }], { session });
  const updatedVendor = await Vendor.findOneAndUpdate(
    { _id: p.vendor._id, hotelId: p.hotelId },
    [{ $set: { currentOutstanding: { $max: [0, { $subtract: ['$currentOutstanding', p.amount] }] } } }],
    { new: true, session },
  );
  await VendorLedgerEntry.create([{
    hotelId:         p.hotelId,
    vendorId:        p.vendor._id,
    entryType:       'payment',
    referenceId:     payment._id,
    referenceNumber: p.paymentNumber,
    debit:           0,
    credit:          p.amount,
    runningBalance:  updatedVendor?.currentOutstanding ?? 0,
    description:     `Payment via ${p.paymentMethod}${p.referenceNumber ? ` (ref: ${p.referenceNumber})` : ''}`,
  }], { session });
  return payment;
}
