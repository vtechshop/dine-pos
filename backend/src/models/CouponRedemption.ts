import mongoose, { Schema, Document } from 'mongoose';

export type RedemptionStatus = 'redeemed' | 'reversed';

export interface ICouponRedemption extends Document {
  hotelId:        mongoose.Types.ObjectId;
  couponId:       mongoose.Types.ObjectId;
  couponCode:     string;
  orderId:        mongoose.Types.ObjectId;
  customerId:     mongoose.Types.ObjectId | null;
  phone:          string;
  discountAmount: number;
  status:         RedemptionStatus;
  redeemedAt:     Date;
  reversedAt:     Date | null;
  reversedReason: string;
  createdAt:      Date;
  updatedAt:      Date;
}

const CouponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    hotelId:        { type: Schema.Types.ObjectId, required: true, ref: 'Hotel' },
    couponId:       { type: Schema.Types.ObjectId, required: true, ref: 'Coupon' },
    couponCode:     { type: String, required: true },
    orderId:        { type: Schema.Types.ObjectId, required: true, ref: 'Order' },
    customerId:     { type: Schema.Types.ObjectId, default: null, ref: 'CustomerProfile' },
    phone:          { type: String, default: '' },
    discountAmount: { type: Number, required: true, min: 0 },
    status:         { type: String, enum: ['redeemed', 'reversed'], default: 'redeemed' },
    redeemedAt:     { type: Date, default: () => new Date() },
    reversedAt:     { type: Date, default: null },
    reversedReason: { type: String, default: '' },
  },
  { timestamps: true },
);

// Idempotency: one redemption record per order + coupon pair
CouponRedemptionSchema.index({ hotelId: 1, couponId: 1, orderId: 1 }, { unique: true });
// Admin list: all redemptions for a coupon sorted by time
CouponRedemptionSchema.index({ hotelId: 1, couponId: 1, redeemedAt: -1 });
// Per-customer limit count by CustomerProfile ID
CouponRedemptionSchema.index({ hotelId: 1, couponId: 1, customerId: 1 }, { sparse: true });
// Per-customer limit count by phone (guests without a CustomerProfile)
CouponRedemptionSchema.index({ hotelId: 1, couponId: 1, phone: 1 }, { sparse: true });
// Cancellation + refund reversal lookup by orderId
CouponRedemptionSchema.index({ hotelId: 1, orderId: 1 });

export default mongoose.model<ICouponRedemption>('CouponRedemption', CouponRedemptionSchema);
