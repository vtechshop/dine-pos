import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  hotelId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  category: mongoose.Types.ObjectId;
  taxPercent: number;
  hsnCode: string;
  image: string;
  isAvailable: boolean;
  isVeg: boolean;
  shortCode: string;
  description: string;
  stock: number;
  isDeleted: boolean;
  recipe: { ingredient: mongoose.Types.ObjectId; quantity: number }[];
  // ── Channel-specific pricing ──────────────────────────────────────────────
  channelPrices: {
    swiggy?:  number | null;
    zomato?:  number | null;
    qr?:      number | null;
    kiosk?:   number | null;
    website?: number | null;
  };
  // ── Platform item IDs after menu sync ─────────────────────────────────────
  platformIds: {
    swiggy?: string;
    zomato?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema: Schema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    taxPercent: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
    hsnCode: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      default: '',
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
    shortCode: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    stock: {
      type: Number,
      default: -1,
      min: -1,
    },
    isDeleted: { type: Boolean, default: false },
    recipe: [{
      ingredient: { type: Schema.Types.ObjectId, ref: 'Ingredient' },
      quantity: { type: Number, required: true, min: 0 },
    }],
    // ── Channel-specific pricing — undefined means use base price ────────────
    channelPrices: {
      swiggy:  { type: Number, default: null },
      zomato:  { type: Number, default: null },
      qr:      { type: Number, default: null },
      kiosk:   { type: Number, default: null },
      website: { type: Number, default: null },
    },
    // ── Platform item IDs after menu sync ─────────────────────────────────────
    platformIds: {
      swiggy: { type: String, default: '' },
      zomato: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

ProductSchema.index({ hotelId: 1, category: 1, isAvailable: 1, isDeleted: 1 });

export default mongoose.model<IProduct>('Product', ProductSchema);
