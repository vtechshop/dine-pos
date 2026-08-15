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
  // ── Razorpay Technology Partner OAuth fields ───────────────────────────────
  isOAuthConnected:        boolean;
  oauthAccessTokenEnc:     string;  // AES-256-GCM encrypted access_token
  oauthRefreshTokenEnc:    string;  // AES-256-GCM encrypted refresh_token (rotates on use)
  oauthPublicToken:        string;  // non-sensitive; replaces key_id in Checkout.js
  oauthConnectedAccountId: string;  // Razorpay razorpay_account_id of the connected merchant
  oauthConnectedAt:        Date | null;
  oauthExpiresAt:          Date | null;  // access_token expiry (~90 days)
  oauthRefreshExpiresAt:   Date | null;  // refresh_token expiry (~180 days from generation)
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
    // ── Razorpay OAuth ────────────────────────────────────────────────────────
    isOAuthConnected:        { type: Boolean, default: false },
    oauthAccessTokenEnc:     { type: String,  default: '' },
    oauthRefreshTokenEnc:    { type: String,  default: '' },
    oauthPublicToken:        { type: String,  default: '' },
    oauthConnectedAccountId: { type: String,  default: '' },
    oauthConnectedAt:        { type: Date,    default: null },
    oauthExpiresAt:          { type: Date,    default: null },
    oauthRefreshExpiresAt:   { type: Date,    default: null },
  },
  { timestamps: true },
);

// One config per gateway type per hotel
schema.index({ hotelId: 1, gatewayType: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ hotelId: 1, isDeleted: 1 });

export default mongoose.model<IPaymentGatewayConfig>('PaymentGatewayConfig', schema);
