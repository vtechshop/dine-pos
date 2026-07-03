import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
  hotelId: mongoose.Types.ObjectId;
  plan: 'starter' | 'professional' | 'enterprise';
  status: 'active' | 'cancelled' | 'expired' | 'pending';
  startDate: Date;
  endDate: Date;
  amount: number;
  currency: string;
  paymentMethod: string;
  transactionId: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    plan:          { type: String, enum: ['starter', 'professional', 'enterprise'], required: true },
    status:        { type: String, enum: ['active', 'cancelled', 'expired', 'pending'], default: 'pending' },
    startDate:     { type: Date, required: true },
    endDate:       { type: Date, required: true },
    amount:        { type: Number, default: 0 },
    currency:      { type: String, default: 'INR' },
    paymentMethod: { type: String, default: '' },
    transactionId: { type: String, default: '' },
    notes:         { type: String, default: '' },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ hotelId: 1, status: 1 });
SubscriptionSchema.index({ endDate: 1 });

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
