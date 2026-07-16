import mongoose, { Schema, Document } from 'mongoose';

export type TableSessionStatus = 'open' | 'closed';

export interface ITableSession extends Document {
  hotelId: mongoose.Types.ObjectId;
  tableId: mongoose.Types.ObjectId;
  tableNumber: string;          // denormalised — avoids join on every order validation
  status: TableSessionStatus;
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string;             // "Admin: Raj" | "Waiter: Ravi" | "QR Self-service"
  guestCount: number;           // atomic counter; incremented via $inc when adding guests
  totalRevenue: number;         // set on close = sum of all billed guest totals
  qrTimeoutMinutes: number;     // copied from hotel settings at open-time; guests who never
                                // order expire after this many idle minutes
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const TableSessionSchema: Schema = new Schema(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    tableId:          { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber:      { type: String, required: true, maxlength: 20 },
    status:           { type: String, enum: ['open', 'closed'], default: 'open' },
    openedAt:         { type: Date, default: () => new Date() },
    closedAt:         { type: Date, default: null },
    openedBy:         { type: String, default: 'Admin', maxlength: 100 },
    guestCount:       { type: Number, default: 0, min: 0 },
    totalRevenue:     { type: Number, default: 0, min: 0 },
    qrTimeoutMinutes: { type: Number, default: 15, min: 1, max: 60 },
    notes:            { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

// ── Indexes (per Architecture v1.1 §3.3) ────────────────────────────────────
// List all open sessions for a hotel (table grid view)
TableSessionSchema.index({ hotelId: 1, status: 1 });
// "Is there an active session for this table?" — hot path on every QR/waiter order
TableSessionSchema.index({ hotelId: 1, tableNumber: 1, status: 1 });
// Same query by ObjectId (used by waiter flow)
TableSessionSchema.index({ hotelId: 1, tableId: 1, status: 1 });
// Session history / reports (sorted by close time)
TableSessionSchema.index({ hotelId: 1, closedAt: -1 });
// Prevent two concurrent open sessions for the same table in the same hotel.
// partialFilterExpression limits the unique constraint to open sessions only —
// a table can have many closed sessions over time.
TableSessionSchema.index(
  { hotelId: 1, tableId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

export default mongoose.model<ITableSession>('TableSession', TableSessionSchema);
