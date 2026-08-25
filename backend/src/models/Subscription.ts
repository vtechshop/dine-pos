import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
  hotelId:       mongoose.Types.ObjectId;
  plan:          'starter' | 'professional' | 'enterprise' | 'standard';
  status:        'active' | 'cancelled' | 'expired' | 'pending';
  startDate:     Date;
  endDate:       Date;
  amount:        number;   // annual amount in INR (not paise)
  currency:      string;
  paymentMethod: string;
  transactionId: string;
  notes:         string;

  // ── Razorpay SaaS Billing fields ─────────────────────────────────────────
  billingCycle:              'yearly' | 'monthly';
  rzpSubscriptionId:         string;   // sub_xxx
  rzpPlanId:                 string;   // plan_xxx used for this cycle
  rzpInvoiceId:              string;   // last invoice ID — idempotency key for invoice.paid
  nextBillingAt:             Date | null;
  failureCount:              number;   // incremented on invoice.payment_failed
  paidAt:                    Date | null;
  cancelledAt:               Date | null;
  cancellationReason:        string;
  isRenewal:                 boolean;  // false = first activation, true = auto-renewal
  printerEntitlementGranted: boolean;  // true only on the first subscription record

  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    plan:          { type: String, enum: ['starter', 'professional', 'enterprise', 'standard'], required: true },
    status:        { type: String, enum: ['active', 'cancelled', 'expired', 'pending'], default: 'pending' },
    startDate:     { type: Date, required: true },
    endDate:       { type: Date, required: true },
    amount:        { type: Number, default: 0 },
    currency:      { type: String, default: 'INR' },
    paymentMethod: { type: String, default: '' },
    transactionId: { type: String, default: '' },
    notes:         { type: String, default: '' },

    // ── Razorpay SaaS Billing ─────────────────────────────────────────────
    billingCycle:              { type: String, enum: ['yearly', 'monthly'], default: 'yearly' },
    rzpSubscriptionId:         { type: String, default: '' },
    rzpPlanId:                 { type: String, default: '' },
    rzpInvoiceId:              { type: String, default: '' },
    nextBillingAt:             { type: Date,    default: null },
    failureCount:              { type: Number,  default: 0 },
    paidAt:                    { type: Date,    default: null },
    cancelledAt:               { type: Date,    default: null },
    cancellationReason:        { type: String,  default: '' },
    isRenewal:                 { type: Boolean, default: false },
    printerEntitlementGranted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

SubscriptionSchema.index({ hotelId: 1, status: 1 });
SubscriptionSchema.index({ endDate: 1 });
SubscriptionSchema.index({ rzpSubscriptionId: 1 }, { sparse: true }); // webhook idempotency lookup

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
