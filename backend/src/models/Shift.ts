import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDrawerMovement {
  _id: Types.ObjectId;
  type: 'cash_in' | 'cash_out';
  amount: number;
  reason: string;
  cashierName: string;
  timestamp: Date;
}

export interface IShift extends Document {
  hotelId: Types.ObjectId;
  cashierId: string;
  cashierName: string;
  openedAt: Date;
  openingCash: number;
  openingNote: string;
  status: 'open' | 'closed';
  // Running totals (updated when orders are settled — populated on close for now)
  cashSales: number;
  upiSales: number;
  cardSales: number;
  otherSales: number;
  totalSales: number;
  totalOrders: number;
  // Drawer in/out totals (derived from movements on close)
  cashIn: number;
  cashOut: number;
  // Closing data
  closedAt: Date | null;
  closingNote: string;
  actualCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  // Embedded drawer movements (opening balance is openingCash, not a movement)
  movements: Types.DocumentArray<IDrawerMovement>;
  createdAt: Date;
  updatedAt: Date;
}

const DrawerMovementSchema = new Schema<IDrawerMovement>(
  {
    type:        { type: String, enum: ['cash_in', 'cash_out'], required: true },
    amount:      { type: Number, required: true, min: 0 },
    reason:      { type: String, default: '' },
    cashierName: { type: String, required: true },
    timestamp:   { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const ShiftSchema = new Schema<IShift>(
  {
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    cashierId:   { type: String, required: true },
    cashierName: { type: String, required: true },
    openedAt:    { type: Date, required: true },
    openingCash: { type: Number, required: true, default: 0 },
    openingNote: { type: String, default: '' },
    status:      { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    // Sales totals
    cashSales:   { type: Number, default: 0 },
    upiSales:    { type: Number, default: 0 },
    cardSales:   { type: Number, default: 0 },
    otherSales:  { type: Number, default: 0 },
    totalSales:  { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    cashIn:      { type: Number, default: 0 },
    cashOut:     { type: Number, default: 0 },
    // Closing
    closedAt:     { type: Date, default: null },
    closingNote:  { type: String, default: '' },
    actualCash:   { type: Number, default: null },
    expectedCash: { type: Number, default: null },
    difference:   { type: Number, default: null },
    // Movements
    movements: [DrawerMovementSchema],
  },
  { timestamps: true },
);

// One open shift per hotel at a time — enforced in route logic too
ShiftSchema.index({ hotelId: 1, status: 1 });
// DB-level uniqueness: only one open shift per hotel (TOCTOU guard)
ShiftSchema.index({ hotelId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
// Shift history sorted by date
ShiftSchema.index({ hotelId: 1, openedAt: -1 });

export default mongoose.model<IShift>('Shift', ShiftSchema);
