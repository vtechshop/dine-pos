import mongoose, { Document, Schema } from 'mongoose';
import type { PaymentStatus, PaymentMethod, RefundStatus, SettlementStatus } from '../services/payment/types';

export interface IPaymentRefund {
  refundId:          string;
  amount:            number;        // in paise
  reason:            string;
  initiatedBy:       string;
  refundedAt:        Date;
  gatewayResponse:   Record<string, unknown>;
  loyaltyReversedAt:      Date | null;  // set after per-refund loyalty reversal; idempotency guard
  giftVoucherRestoredAt:  Date | null;  // set after per-refund voucher restoration; idempotency guard
}

export interface IPayment extends Document {
  hotelId:               mongoose.Types.ObjectId;
  orderId:               mongoose.Types.ObjectId;
  internalTransactionId: string;   // DPO-generated unique TX ID
  gatewayTransactionId:  string;   // Gateway's payment ID
  gatewayOrderId:        string;   // Gateway's order ID
  gatewayType:           string;
  status:                PaymentStatus;
  amount:                number;   // in paise
  currency:              string;
  paymentMethod:         PaymentMethod;
  gatewayResponse:       Record<string, unknown>;
  webhookData:           Record<string, unknown>;
  refundStatus:          RefundStatus;
  refundedAmount:        number;   // total refunded so far, in paise
  refunds:               IPaymentRefund[];
  settlementStatus:      SettlementStatus;
  settlementId:          string;
  failureReason:         string;
  initiatedBy:           string;   // userId | 'webhook' | 'system'
  refundInProgress:      boolean;  // advisory lock: true while a refund gateway call is in flight
  loyaltyEarnedAt:       Date | null;  // set after earn succeeds; idempotency guard
  loyaltyEarnPoints:     number;       // points awarded for this payment (0 = none)
  loyaltyReversedAt:     Date | null;  // set after reversal on refund; idempotency guard
  createdAt:             Date;
  updatedAt:             Date;
}

const refundSchema = new Schema<IPaymentRefund>(
  {
    refundId:          { type: String, required: true },
    amount:            { type: Number, required: true, min: 0 },
    reason:            { type: String, default: '' },
    initiatedBy:       { type: String, default: '' },
    refundedAt:        { type: Date, default: Date.now },
    gatewayResponse:   { type: Schema.Types.Mixed, default: {} },
    loyaltyReversedAt:     { type: Date, default: null },
    giftVoucherRestoredAt: { type: Date, default: null },
  },
  { _id: false },
);

const schema = new Schema<IPayment>(
  {
    hotelId:               { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    orderId:               { type: Schema.Types.ObjectId, ref: 'Order',  required: true },
    internalTransactionId: { type: String, required: true, unique: true },
    gatewayTransactionId:  { type: String, default: '' },
    gatewayOrderId:        { type: String, default: '' },
    gatewayType:           { type: String, required: true },
    status:                { type: String, enum: ['pending','processing','success','failed','cancelled','refunded','partial_refunded'], default: 'pending' },
    amount:                { type: Number, required: true, min: 0 },
    currency:              { type: String, default: 'INR', maxlength: 3 },
    paymentMethod:         { type: String, enum: ['upi','card','netbanking','wallet','emi','qr','other'], default: 'other' },
    gatewayResponse:       { type: Schema.Types.Mixed, default: {} },
    webhookData:           { type: Schema.Types.Mixed, default: {} },
    refundStatus:          { type: String, enum: ['none','pending','partial','full'], default: 'none' },
    refundedAmount:        { type: Number, default: 0, min: 0 },
    refunds:               { type: [refundSchema], default: [] },
    settlementStatus:      { type: String, enum: ['pending','settled','on_hold'], default: 'pending' },
    settlementId:          { type: String, default: '' },
    failureReason:         { type: String, default: '' },
    initiatedBy:           { type: String, default: '' },
    refundInProgress:      { type: Boolean, default: false },
    loyaltyEarnedAt:       { type: Date, default: null },
    loyaltyEarnPoints:     { type: Number, default: 0 },
    loyaltyReversedAt:     { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ hotelId: 1, createdAt: -1 });
schema.index({ hotelId: 1, orderId: 1 });
schema.index({ hotelId: 1, status: 1, createdAt: -1 });
schema.index({ hotelId: 1, gatewayType: 1, createdAt: -1 });
schema.index({ gatewayTransactionId: 1 }, { sparse: true });

export default mongoose.model<IPayment>('Payment', schema);
