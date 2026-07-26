import mongoose, { Document, Schema } from 'mongoose';
import type { GatewayType, GatewayEnvironment } from '../services/payment/types';

export interface IPaymentGatewayConfig extends Document {
  hotelId:           mongoose.Types.ObjectId;
  gatewayType:       GatewayType;
  displayName:       string;
  merchantId:        string;
  apiKey:            string;
  apiSecretEnc:      string;       // AES-256-GCM encrypted
  webhookSecretEnc:  string;       // AES-256-GCM encrypted
  environment:       GatewayEnvironment;
  isActive:          boolean;
  isDeleted:         boolean;
  testResult: {
    lastTestedAt?: Date;
    success?:      boolean;
    message?:      string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPaymentGatewayConfig>(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    gatewayType:      { type: String, enum: ['razorpay', 'cashfree', 'phonepe', 'payu', 'paytm', 'bharatpe'], required: true },
    displayName:      { type: String, required: true, trim: true, maxlength: 100 },
    merchantId:       { type: String, default: '', trim: true },
    apiKey:           { type: String, default: '', trim: true },
    apiSecretEnc:     { type: String, default: '' },
    webhookSecretEnc: { type: String, default: '' },
    environment:      { type: String, enum: ['sandbox', 'live'], default: 'sandbox' },
    isActive:         { type: Boolean, default: false },
    isDeleted:        { type: Boolean, default: false },
    testResult: {
      lastTestedAt: Date,
      success:      Boolean,
      message:      String,
    },
  },
  { timestamps: true },
);

// One config per gateway type per hotel
schema.index({ hotelId: 1, gatewayType: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ hotelId: 1, isDeleted: 1 });

export default mongoose.model<IPaymentGatewayConfig>('PaymentGatewayConfig', schema);
