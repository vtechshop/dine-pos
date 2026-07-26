import mongoose, { Schema, Document } from 'mongoose';

export interface IModifierOption {
  _id: mongoose.Types.ObjectId;
  name: string;
  price: number;
  sku: string;
  barcode: string;
  isActive: boolean;
  displayOrder: number;
}

export interface IModifierGroup extends Document {
  hotelId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  displayOrder: number;
  isRequired: boolean;
  selectionType: 'single' | 'multi';
  minSelections: number;
  maxSelections: number;
  options: IModifierOption[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ModifierOptionSchema: Schema = new Schema({
  name:         { type: String, required: true, trim: true },
  price:        { type: Number, required: true, min: 0, default: 0 },
  sku:          { type: String, default: '', trim: true },
  barcode:      { type: String, default: '', trim: true },
  isActive:     { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
});

const ModifierGroupSchema: Schema = new Schema(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name:          { type: String, required: true, trim: true },
    description:   { type: String, default: '', trim: true },
    isActive:      { type: Boolean, default: true },
    displayOrder:  { type: Number, default: 0 },
    isRequired:    { type: Boolean, default: false },
    selectionType: { type: String, enum: ['single', 'multi'], default: 'single' },
    minSelections: { type: Number, default: 0, min: 0 },
    maxSelections: { type: Number, default: 1, min: 1 },
    options:       [ModifierOptionSchema],
    isDeleted:     { type: Boolean, default: false },
  },
  { timestamps: true }
);

ModifierGroupSchema.index({ hotelId: 1, isDeleted: 1, isActive: 1 });
ModifierGroupSchema.index({ hotelId: 1, name: 1 });

export default mongoose.model<IModifierGroup>('ModifierGroup', ModifierGroupSchema);
