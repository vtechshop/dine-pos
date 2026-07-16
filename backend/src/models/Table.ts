import mongoose, { Schema, Document } from 'mongoose';

export interface ITable extends Document {
  hotelId: mongoose.Types.ObjectId;
  number: number;
  name: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'inactive';
  currentOrderId: mongoose.Types.ObjectId | null;    // kept for backward compat (tableSessions=false)
  // ── Table Session (Architecture v1.1) ─────────────────────────────────
  currentSessionId: mongoose.Types.ObjectId | null;  // null when table is available
  x: number;
  y: number;
  shape: 'square' | 'round';
}

const TableSchema: Schema = new Schema(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    number:         { type: Number, required: true },
    name:           { type: String, default: '' },
    capacity:       { type: Number, default: 4, min: 1 },
    status:         { type: String, enum: ['available', 'occupied', 'reserved', 'inactive'], default: 'available' },
    currentOrderId:   { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    // Architecture v1.1: currentSessionId is the canonical occupancy pointer when
    // features.tableSessions is enabled; currentOrderId is preserved for backward compat
    currentSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    x:              { type: Number, default: 0 },
    y:              { type: Number, default: 0 },
    shape:          { type: String, enum: ['square', 'round'], default: 'square' },
  },
  { timestamps: true }
);

TableSchema.index({ hotelId: 1, number: 1 }, { unique: true });

export default mongoose.model<ITable>('Table', TableSchema);
