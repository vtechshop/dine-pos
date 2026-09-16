import mongoose, { Schema, Document } from 'mongoose';

export type LoyaltyTransactionType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'reverse'
  | 'expire'
  | 'transfer_in'
  | 'transfer_out';

export interface ILoyaltyTransaction extends Document {
  customerId: mongoose.Types.ObjectId;
  hotelId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId | null;
  paymentId: mongoose.Types.ObjectId | null;
  sessionId: mongoose.Types.ObjectId | null;
  guestId: mongoose.Types.ObjectId | null;
  transactionType: LoyaltyTransactionType;
  // positive = earn / adjust / transfer_in
  // negative = redeem / expire / transfer_out
  points: number;
  balanceAfter: number;   // snapshot — allows ledger reconstruction without re-summing
  remarks: string;
  expiresAt: Date | null; // set for 'earn' entries when hotel configures point expiry
  createdBy: string;      // "system" | "cashier:Raj" | "admin"
  createdAt: Date;
  // Org-loyalty context (null for single-branch transactions)
  orgCustomerId:  mongoose.Types.ObjectId | null;
  branchHotelId:  mongoose.Types.ObjectId | null;
  idempotencyKey: string | null;
  // Intentionally no updatedAt: this collection is append-only / immutable
}

const LoyaltyTransactionSchema: Schema = new Schema(
  {
    customerId:      { type: Schema.Types.ObjectId, ref: 'CustomerProfile', required: true, index: true },
    hotelId:         { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    orderId:         { type: Schema.Types.ObjectId, ref: 'Order',    default: null },
    paymentId:       { type: Schema.Types.ObjectId, ref: 'Payment',  default: null },
    sessionId:       { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    guestId:         { type: Schema.Types.ObjectId, ref: 'Guest', default: null },
    transactionType: {
      type: String,
      enum: ['earn', 'redeem', 'adjust', 'reverse', 'expire', 'transfer_in', 'transfer_out'],
      required: true,
    },
    points:       { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    remarks:      { type: String, default: '', maxlength: 500 },
    expiresAt:    { type: Date, default: null },
    orgCustomerId:  { type: Schema.Types.ObjectId, ref: 'OrganizationCustomer', default: null },
    branchHotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    idempotencyKey: { type: String, default: null, maxlength: 200 },
    createdBy:    { type: String, default: 'system', maxlength: 100 },
  },
  {
    // Only createdAt — no updatedAt because this is an immutable append-only ledger
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// ── Indexes (per Architecture v1.1 §3.2) ────────────────────────────────────
// Customer history — most frequently used query (paginated)
LoyaltyTransactionSchema.index({ customerId: 1, createdAt: -1 });
// Hotel-level earn/redeem reports
LoyaltyTransactionSchema.index({ hotelId: 1, transactionType: 1, createdAt: -1 });
// Full hotel audit trail
LoyaltyTransactionSchema.index({ hotelId: 1, createdAt: -1 });
// Find transactions for a specific order (sparse — most transactions have orderId)
LoyaltyTransactionSchema.index({ orderId: 1 }, { sparse: true });
// Expiry batch / lazy-expiry sweep
LoyaltyTransactionSchema.index({ expiresAt: 1 }, { sparse: true });
// Org-loyalty customer history
LoyaltyTransactionSchema.index({ orgCustomerId: 1, createdAt: -1 }, { sparse: true });
// HQ branch-by-branch breakdown
LoyaltyTransactionSchema.index({ orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }, { sparse: true });
// Idempotency key — unique and sparse
LoyaltyTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default mongoose.model<ILoyaltyTransaction>('LoyaltyTransaction', LoyaltyTransactionSchema);
