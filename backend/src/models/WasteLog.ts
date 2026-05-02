import mongoose, { Schema, Document } from 'mongoose';

export interface IWasteLog extends Document {
  hotelId: mongoose.Types.ObjectId;
  productId?: mongoose.Types.ObjectId;
  productName: string;
  quantity: number;
  unit: string;
  reason: 'expired' | 'damaged' | 'overcooked' | 'returned' | 'other';
  estimatedLoss: number;
  date: Date;
  notes: string;
}

const WasteLogSchema: Schema = new Schema(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    productId:     { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    productName:   { type: String, required: true, trim: true },
    quantity:      { type: Number, required: true, min: 0 },
    unit:          { type: String, default: 'pcs' },
    reason:        { type: String, enum: ['expired', 'damaged', 'overcooked', 'returned', 'other'], default: 'other' },
    estimatedLoss: { type: Number, default: 0, min: 0 },
    date:          { type: Date, required: true, default: Date.now },
    notes:         { type: String, default: '' },
  },
  { timestamps: true }
);

WasteLogSchema.index({ hotelId: 1, date: -1 });

export default mongoose.model<IWasteLog>('WasteLog', WasteLogSchema);
