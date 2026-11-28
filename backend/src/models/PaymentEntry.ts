import mongoose, { Schema, Document } from 'mongoose';

/**
 * PaymentEntry — the payment ledger (Phase 5 · Batch 2).
 *
 * One immutable document per money movement against orders, each with its OWN timestamp:
 *   payment   — money received (cash / upi / card / online) or a tender (voucher / wallet)
 *   discount  — a bill-level reduction applied when a guest / table is settled (loyalty,
 *               complimentary); reduces net sales, is not a collection
 *   refund    — money given back (counter or gateway); reported separately from collections
 *   write_off — an unpaid amount written off by a manager (reason mandatory, audited)
 *   tip       — a gratuity received with a payment (owner decision, Batch 3): money received but
 *               NOT part of the bill, sales or collections. It settles no order. Reported on its
 *               own, and counted in the cash drawer when it is paid in cash.
 *
 * Collections = type 'payment' with a money method (cash, upi, card, online), by paidAt.
 * Vouchers / wallet are tenders: they settle a bill but are not money received at that time.
 *
 * `allocations` say which orders the entry settles (a table bill settles several orders;
 * a split payment is several entries for one order). `idempotencyKey` is unique per hotel so
 * the same payment can never be recorded twice (double clicks, QR verify vs webhook, retries).
 *
 * Additive collection — existing documents are not changed. Orders paid before this ledger
 * existed are reported through a read-only fallback (see utils/financeDefinitions.ts).
 */
export type PaymentEntryType   = 'payment' | 'discount' | 'refund' | 'write_off' | 'reversal' | 'tip';
export type PaymentEntryMethod =
  | 'cash' | 'upi' | 'card' | 'online'          // money received
  | 'voucher' | 'wallet'                          // tenders (prepaid instruments)
  | 'loyalty' | 'complimentary' | 'other';        // discounts / write-off notes

export const MONEY_METHODS: PaymentEntryMethod[] = ['cash', 'upi', 'card', 'online'];

export interface IPaymentAllocation {
  orderId: mongoose.Types.ObjectId;
  amount:  number;
}

export interface IPaymentEntry extends Document {
  hotelId:        mongoose.Types.ObjectId;
  type:           PaymentEntryType;
  method:         PaymentEntryMethod;
  amount:         number;                 // rupees, exact paise, always positive
  paidAt:         Date;                   // when the money moved (or the write-off was approved)
  source:         string;                 // pathway that recorded it (pay, pay_now, completion, guest_bill, …)
  allocations:    IPaymentAllocation[];
  sessionId:      mongoose.Types.ObjectId | null;
  guestId:        mongoose.Types.ObjectId | null;
  paymentId:      mongoose.Types.ObjectId | null;   // gateway Payment document, when online
  reference:      string;                 // UPI ref / card approval / gateway transaction id
  reason:         string;                 // mandatory for write_off; optional otherwise
  recordedBy:     string;
  idempotencyKey: string;
  reversesEntryId: mongoose.Types.ObjectId | null;   // Batch 3 (3E): the entry a reversal undoes
  createdAt:      Date;
}

const AllocationSchema = new Schema<IPaymentAllocation>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    amount:  { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const PaymentEntrySchema = new Schema<IPaymentEntry>(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    type:           { type: String, enum: ['payment', 'discount', 'refund', 'write_off', 'reversal', 'tip'], required: true },
    method:         { type: String, enum: ['cash', 'upi', 'card', 'online', 'voucher', 'wallet', 'loyalty', 'complimentary', 'other'], required: true },
    amount:         { type: Number, required: true, min: 0 },
    paidAt:         { type: Date, required: true },
    source:         { type: String, required: true, maxlength: 40 },
    allocations:    { type: [AllocationSchema], default: [] },
    sessionId:      { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    guestId:        { type: Schema.Types.ObjectId, ref: 'Guest', default: null },
    paymentId:      { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reference:      { type: String, default: '', maxlength: 120 },
    reason:         { type: String, default: '', maxlength: 500 },
    recordedBy:     { type: String, default: '', maxlength: 100 },
    idempotencyKey: { type: String, required: true, maxlength: 200 },
    // Batch 3 (3E): a reversal (bill reopened for correction) points at the entry it undoes;
    // the original is never changed. Each entry can be reversed once (key reverse:<id>).
    reversesEntryId: { type: Schema.Types.ObjectId, ref: 'PaymentEntry', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The same payment can never be recorded twice.
PaymentEntrySchema.index({ hotelId: 1, idempotencyKey: 1 }, { unique: true });
// Collections / refunds by time (reports).
PaymentEntrySchema.index({ hotelId: 1, type: 1, paidAt: 1 });
// Everything recorded against one order (balances, receipts).
PaymentEntrySchema.index({ 'allocations.orderId': 1 });

export default mongoose.model<IPaymentEntry>('PaymentEntry', PaymentEntrySchema);
