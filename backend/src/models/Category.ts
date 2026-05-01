import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  hotelId: mongoose.Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema: Schema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
    },
    icon: {
      type: String,
      default: 'restaurant',
    },
    color: {
      type: String,
      default: '#FF6B35',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Unique per hotel (same name allowed across different hotels)
CategorySchema.index({ hotelId: 1, name: 1 }, { unique: true, sparse: true });

export default mongoose.model<ICategory>('Category', CategorySchema);
