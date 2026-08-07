import mongoose, { Schema, Document } from 'mongoose';

export type CouponType = 'percent' | 'flat';
export type CouponStatus = 'active' | 'inactive' | 'expired' | 'exhausted';

export interface ICoupon extends Document {
  hotelId:             mongoose.Types.ObjectId;
  code:                string;
  description:         string;
  type:                CouponType;
  value:               number;   // percent (0-100) or flat INR amount
  minOrderValue:       number;   // minimum order total to apply
  maxDiscount:         number;   // cap on discount for percent-type (0 = unlimited)
  validFrom:           Date;
  validUntil:          Date | null;
  usageLimit:          number;   // 0 = unlimited
  perCustomerLimit:    number;   // 0 = unlimited per customer
  usageCount:          number;   // auto-incremented on each successful redemption
  applicableCategories: mongoose.Types.ObjectId[];
  applicableProducts:  mongoose.Types.ObjectId[];
  isActive:            boolean;
  isDeleted:           boolean;
  createdBy:           string;
  createdAt:           Date;
  updatedAt:           Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    code:        { type: String, required: true, trim: true, uppercase: true, maxlength: 50 },
    description: { type: String, default: '', maxlength: 300 },
    type:        { type: String, enum: ['percent', 'flat'], required: true },
    value:       { type: Number, required: true, min: 0 },
    minOrderValue:   { type: Number, default: 0, min: 0 },
    maxDiscount:     { type: Number, default: 0, min: 0 },
    validFrom:       { type: Date, required: true },
    validUntil:      { type: Date, default: null },
    usageLimit:      { type: Number, default: 0, min: 0 },
    perCustomerLimit:{ type: Number, default: 0, min: 0 },
    usageCount:      { type: Number, default: 0, min: 0 },
    applicableCategories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    applicableProducts:   [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    isActive:  { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

CouponSchema.index({ hotelId: 1, code: 1 }, { unique: true });
CouponSchema.index({ hotelId: 1, isActive: 1, isDeleted: 1 });
CouponSchema.index({ hotelId: 1, validFrom: 1, validUntil: 1 });

export default mongoose.model<ICoupon>('Coupon', CouponSchema);
