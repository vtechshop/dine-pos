import mongoose, { Schema, Document } from 'mongoose';

export interface IIngredient extends Document {
  hotelId: mongoose.Types.ObjectId;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPerUnit: number;
  createdAt: Date;
  updatedAt: Date;
}

const IngredientSchema: Schema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name: {
      type: String,
      required: [true, 'Ingredient name is required'],
      trim: true,
    },
    unit: {
      type: String,
      required: true,
      default: 'kg',
    },
    currentStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: 0,
    },
    costPerUnit: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

IngredientSchema.index({ hotelId: 1, name: 1 });

export default mongoose.model<IIngredient>('Ingredient', IngredientSchema);
