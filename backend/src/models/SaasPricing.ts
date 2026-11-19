import mongoose, { Schema, Document } from 'mongoose';

/**
 * DinePOS subscription price set by Super Admin (one document, key 'standard').
 * rzpPlanId is the Razorpay plan created for this price; new subscriptions use it.
 */
export interface ISaasPricing extends Document {
  key:         'standard';
  annualPrice: number;   // INR per year
  rzpPlanId:   string;
  updatedAt:   Date;
}

const SaasPricingSchema = new Schema<ISaasPricing>(
  {
    key:         { type: String, enum: ['standard'], required: true, unique: true },
    annualPrice: { type: Number, required: true, min: 1 },
    rzpPlanId:   { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<ISaasPricing>('SaasPricing', SaasPricingSchema);
