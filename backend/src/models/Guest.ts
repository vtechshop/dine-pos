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
  qrSessionToken: string | null;    // opaque 32-byte hex; stored in browser localStorage
                                    // rotated on every state change; null for staff-created guests
  qrTokenExpiresAt: Date | null;    // null once first order placed; lazy expiry check on every QR request
  status: GuestStatus;
  totalAmount: number;              // running total; incremented when an order is linked to this guest
  paymentMethod: GuestPaymentMethod | null;
  splitDetails: IGuestSplitDetails;
  paidAmount: number | null;
  billedAt: Date | null;
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
    qrSessionToken:   { type: String, default: null },
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
    paidAmount: { type: Number, default: null },
    billedAt:   { type: Date, default: null },
    notes:      { type: String, default: '', maxlength: 500 },
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
GuestSchema.index({ qrSessionToken: 1 }, { unique: true, sparse: true });

export default mongoose.model<IGuest>('Guest', GuestSchema);
