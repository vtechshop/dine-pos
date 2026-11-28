import mongoose, { Schema, Document } from 'mongoose';

export type GuestStatus = 'active' | 'billed' | 'left' | 'cancelled';
export type GuestPaymentMethod = 'cash' | 'upi' | 'card' | 'split' | 'complimentary';

export interface IGuestSplitDetails {
  cash: number;
  upi: number;
  card: number;
}

export interface IGuest extends Document {
  sessionId: mongoose.Types.ObjectId;
  hotelId: mongoose.Types.ObjectId;
  tableId: mongoose.Types.ObjectId;
  tableNumber: string;              // denormalised
  customerId: mongoose.Types.ObjectId | null;   // ref: CustomerProfile; null = anonymous
  guestNumber: number;              // 1-based; assigned atomically via $inc on session.guestCount
  displayLabel: string;             // "Guest A", "Guest B"… or custom name (max 26 = Guest Z, then "Guest 27")
  qrSessionToken?: string | null;   // opaque 32-byte hex; stored in browser localStorage
                                    // rotated on every state change; ABSENT for staff-created
                                    // and billed guests (never stored as null — see the index below)
  qrTokenExpiresAt: Date | null;    // null once first order placed; lazy expiry check on every QR request
  status: GuestStatus;
  totalAmount: number;              // running total; incremented when an order is linked to this guest
  paymentMethod: GuestPaymentMethod | null;
  splitDetails: IGuestSplitDetails;
  paidAmount: number | null;
  billedAt: Date | null;
  loyaltyPointsRedeemed: number;   // points redeemed at billing (0 = none)
  loyaltyDiscountAmount: number;   // rupee value of redeemed points
  loyaltyEarnedAt: Date | null;    // set after earn succeeds; idempotency guard
  lifetimeSpendAt: Date | null;    // set after lifetimeSpend is incremented; idempotency guard
  giftVoucherId:    mongoose.Types.ObjectId | null;
  giftVoucherCode:  string;
  giftVoucherAmount: number;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const GuestSchema: Schema = new Schema(
  {
    sessionId:        { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    tableId:          { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber:      { type: String, required: true, maxlength: 20 },
    customerId:       { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
    guestNumber:      { type: Number, required: true, min: 1 },
    displayLabel:     { type: String, required: true, maxlength: 50 },
    // No default: a guest without a QR token must not have the field at all (see index note below).
    qrSessionToken:   { type: String },
    qrTokenExpiresAt: { type: Date, default: null },
    status:           { type: String, enum: ['active', 'billed', 'left', 'cancelled'], default: 'active' },
    totalAmount:      { type: Number, default: 0, min: 0 },
    paymentMethod:    {
      type: String,
      enum: ['cash', 'upi', 'card', 'split', 'complimentary'],
      default: null,
    },
    splitDetails: {
      cash: { type: Number, default: 0 },
      upi:  { type: Number, default: 0 },
      card: { type: Number, default: 0 },
    },
    paidAmount:             { type: Number, default: null },
    billedAt:               { type: Date, default: null },
    loyaltyPointsRedeemed:  { type: Number, default: 0, min: 0 },
    loyaltyDiscountAmount:  { type: Number, default: 0, min: 0 },
    loyaltyEarnedAt:        { type: Date, default: null },
    lifetimeSpendAt:        { type: Date, default: null },
    giftVoucherId:          { type: Schema.Types.ObjectId, ref: 'GiftVoucher', default: null },
    giftVoucherCode:        { type: String, default: '' },
    giftVoucherAmount:      { type: Number, default: 0, min: 0 },
    notes:                  { type: String, default: '', maxlength: 500 },
    // Batch 2 (2C): manager-approved write-off of an unpaid balance (walk-out). Also recorded
    // as a write_off entry in the payment ledger and in the audit log.
    writeOffAmount:         { type: Number, default: 0, min: 0 },
    writeOffReason:         { type: String, default: '', maxlength: 500 },
    writeOffBy:             { type: String, default: '' },
    writeOffAt:             { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Indexes (per Architecture v1.1 §3.4) ────────────────────────────────────
// Guests in a session (used by cashier drill-down)
GuestSchema.index({ sessionId: 1 });
// Session guests with hotel tenant scope
GuestSchema.index({ hotelId: 1, sessionId: 1 });
// Customer visit history across sessions
GuestSchema.index({ hotelId: 1, customerId: 1, createdAt: -1 }, { sparse: true });
// QR token lookup — hot path on EVERY QR order request; must be O(log n)
// A sparse index skips documents WITHOUT the field but still indexes an explicit null,
// so storing `qrSessionToken: null` on more than one guest (in any hotel) fails with
// E11000. Guests without a token therefore never carry the field: it is omitted on create
// and removed with UNSET_QR_TOKEN when a token is cleared. Queries for staff guests use
// `{ qrSessionToken: null }`, which matches a missing field as well.
GuestSchema.index({ qrSessionToken: 1 }, { unique: true, sparse: true });

/** `$unset` fragment that clears a guest's QR token without storing null (see index note). */
export const UNSET_QR_TOKEN = { qrSessionToken: 1 } as const;

export default mongoose.model<IGuest>('Guest', GuestSchema);
