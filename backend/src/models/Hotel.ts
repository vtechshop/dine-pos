import mongoose, { Schema, Document } from 'mongoose';

export interface IHotel extends Document {
  // Basic Info
  hotelName: string;
  ownerName: string;
  businessType: 'veg' | 'non-veg' | 'both';

  // Contact
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;

  // Legal
  fssaiNumber: string;
  fssaiVerified: boolean;
  gstNumber: string;
  gstVerified: boolean;
  panNumber: string;
  panVerified: boolean;

  // Bank
  bankName: string;
  bankBranch: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  ifscVerified: boolean;

  // Auth credentials (set by super admin on approval)
  adminId: string;
  adminPasswordHash: string;

  // Status
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  rejectionReason: string;
  approvedAt: Date | null;

  // Credential reset
  resetRequested: boolean;
  resetRequestedAt: Date | null;
  resetFulfilledAt: Date | null;

  // Premium / Subscription
  isPremium: boolean;
  premiumPlan: string;
  premiumExpiry: Date | null;
  trialEndsAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const HotelSchema: Schema = new Schema(
  {
    hotelName:        { type: String, required: true },
    ownerName:        { type: String, required: true },
    businessType:     { type: String, enum: ['veg', 'non-veg', 'both'], default: 'both' },

    phone:            { type: String, required: true },
    email:            { type: String, default: '' },
    address:          { type: String, required: true },
    city:             { type: String, default: '' },
    state:            { type: String, default: '' },
    pincode:          { type: String, default: '' },

    fssaiNumber:      { type: String, required: true },
    fssaiVerified:    { type: Boolean, default: false },
    gstNumber:        { type: String, default: '' },
    gstVerified:      { type: Boolean, default: false },
    panNumber:        { type: String, default: '' },
    panVerified:      { type: Boolean, default: false },

    bankName:         { type: String, default: '' },
    bankBranch:       { type: String, default: '' },
    bankAccountHolder:{ type: String, default: '' },
    bankAccountNumber:{ type: String, default: '' },
    bankIfscCode:     { type: String, default: '' },
    ifscVerified:     { type: Boolean, default: false },

    adminId:          { type: String, default: '' },
    adminPasswordHash:{ type: String, default: '' },

    status:             { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending' },
    rejectionReason:    { type: String, default: '' },
    approvedAt:         { type: Date, default: null },

    resetRequested:     { type: Boolean, default: false },
    resetRequestedAt:   { type: Date, default: null },
    resetFulfilledAt:   { type: Date, default: null },

    isPremium:          { type: Boolean, default: false },
    premiumPlan:        { type: String, default: 'free' },
    premiumExpiry:      { type: Date, default: null },
    trialEndsAt:        { type: Date, default: null },
  },
  { timestamps: true }
);

HotelSchema.index({ phone: 1 });     // login + registration lookup
HotelSchema.index({ status: 1 });    // super admin hotel list filter
HotelSchema.index({ adminId: 1 });   // credential lookup on login

export default mongoose.model<IHotel>('Hotel', HotelSchema);
