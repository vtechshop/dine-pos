import mongoose, { Schema, Document } from 'mongoose';

export type WasteReason =
  | 'expired'
  | 'spoiled'
  | 'damaged'
  | 'overcooked'
  | 'returned'
  | 'overproduction'
  | 'preparation'
  | 'spillage'
  | 'other';

export interface IWasteLog extends Document {
  hotelId: mongoose.Types.ObjectId;
  productId?: mongoose.Types.ObjectId;
  ingredientId?: mongoose.Types.ObjectId;  // Set when waste is ingredient-level
  productName: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  estimatedLoss: number;
  date: Date;
  notes: string;
  actualDeduction?: number;  // actual stock deducted (may be < quantity if stock was insufficient)
}

const WasteLogSchema: Schema = new Schema(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    productId:     { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    ingredientId:  { type: Schema.Types.ObjectId, ref: 'Ingredient', default: null },
    productName:   { type: String, required: true, trim: true },
    quantity:      { type: Number, required: true, min: 0 },
    unit:          { type: String, default: 'pcs' },
    reason: {
      type: String,
      enum: ['expired', 'spoiled', 'damaged', 'overcooked', 'returned', 'overproduction', 'preparation', 'spillage', 'other'],
      default: 'other',
    },
    estimatedLoss:   { type: Number, default: 0, min: 0 },
    date:            { type: Date, required: true, default: Date.now },
    notes:           { type: String, default: '' },
    actualDeduction: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

WasteLogSchema.index({ hotelId: 1, date: -1 });

export default mongoose.model<IWasteLog>('WasteLog', WasteLogSchema);
