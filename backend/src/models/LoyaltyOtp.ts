import mongoose, { Schema, Document } from 'mongoose';

export interface ILoyaltyOtp extends Document {
  hotelId:    mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  phone:      string;
  purpose:    'redemption';
  otp:        string;        // hashed
  attempts:   number;        // wrong-attempt counter
  expiresAt:  Date;          // TTL index drives automatic cleanup
  usedAt:     Date | null;   // stamped on successful verify
  createdAt:  Date;
}

const LoyaltyOtpSchema = new Schema(
  {
    hotelId:    { type: Schema.Types.ObjectId, ref: 'Hotel',            required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'CustomerProfile',  required: true },
    phone:      { type: String, required: true },
    purpose:    { type: String, enum: ['redemption'], required: true },
    otp:        { type: String, required: true },
    attempts:   { type: Number, default: 0, min: 0, max: 10 },
    expiresAt:  { type: Date, required: true },
    usedAt:     { type: Date, default: null },
  },
  { timestamps: true },
);

// TTL index — MongoDB auto-removes expired OTP docs
LoyaltyOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound: look up active OTPs quickly
LoyaltyOtpSchema.index({ hotelId: 1, customerId: 1, purpose: 1, usedAt: 1 });

export default mongoose.model<ILoyaltyOtp>('LoyaltyOtp', LoyaltyOtpSchema);
