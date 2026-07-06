import mongoose, { Schema, Document } from 'mongoose';

export interface IFeatureFlags {
  payment: boolean;
  reservations: boolean;
  customerChat: boolean;
  qrOrdering: boolean;
  expenses: boolean;
  reports: boolean;
  tables: boolean;
  ingredients: boolean;
  waste: boolean;
  aggregator: boolean;
}

export type BusinessType =
  | 'restaurant' | 'hotel' | 'bakery' | 'cafe' | 'sweet-shop'
  | 'juice-shop' | 'fast-food' | 'cloud-kitchen' | 'food-court' | 'mess' | 'catering'
  | 'veg' | 'non-veg' | 'both';

export interface IHotel extends Document {
  // Basic Info
  hotelName: string;
  ownerName: string;
  businessType: BusinessType;
  referralCode: string;

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

  // Status — 'trial' = approved + within trial period
  status: 'pending' | 'trial' | 'active' | 'expired' | 'suspended' | 'rejected';
  rejectionReason: string;
  approvedAt: Date | null;

  // Credential reset
  resetRequested: boolean;
  resetRequestedAt: Date | null;
  resetFulfilledAt: Date | null;

  // Trial management
  trialStartDate: Date | null;
  trialEndDate: Date | null;

  // Subscription
  subscriptionPlan: 'none' | 'starter' | 'professional' | 'enterprise';
  planStartDate: Date | null;
  planExpiryDate: Date | null;

  // New subscription fields (canonical)
  subscriptionType: 'trial' | 'starter' | 'professional' | 'enterprise';
  subscriptionStartDate: Date | null;
  subscriptionEndDate: Date | null;

  // Feature flags (per-hotel capability toggles)
  features: IFeatureFlags;

  // Legacy Premium / Subscription (kept for backwards compat)
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
    businessType: {
      type: String,
      enum: ['restaurant', 'hotel', 'bakery', 'cafe', 'sweet-shop', 'juice-shop', 'fast-food',
             'cloud-kitchen', 'food-court', 'mess', 'catering', 'veg', 'non-veg', 'both'],
      default: 'restaurant',
    },
    referralCode:     { type: String, default: '' },

    phone:            { type: String, required: true },
    email:            { type: String, default: '' },
    address:          { type: String, default: '' },
    city:             { type: String, default: '' },
    state:            { type: String, default: '' },
    pincode:          { type: String, default: '' },

    fssaiNumber:      { type: String, default: '' },
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

    status:             { type: String, enum: ['pending', 'trial', 'active', 'expired', 'suspended', 'rejected'], default: 'pending' },
    rejectionReason:    { type: String, default: '' },
    approvedAt:         { type: Date, default: null },

    resetRequested:     { type: Boolean, default: false },
    resetRequestedAt:   { type: Date, default: null },
    resetFulfilledAt:   { type: Date, default: null },

    // Trial management
    trialStartDate:     { type: Date, default: null },
    trialEndDate:       { type: Date, default: null },

    // Subscription (legacy)
    subscriptionPlan:   { type: String, enum: ['none', 'starter', 'professional', 'enterprise'], default: 'none' },
    planStartDate:      { type: Date, default: null },
    planExpiryDate:     { type: Date, default: null },

    // Subscription (canonical)
    subscriptionType:       { type: String, enum: ['trial', 'starter', 'professional', 'enterprise'], default: 'trial' },
    subscriptionStartDate:  { type: Date, default: null },
    subscriptionEndDate:    { type: Date, default: null },

    // Feature flags
    features: {
      payment:        { type: Boolean, default: false },
      reservations:   { type: Boolean, default: true },
      customerChat:   { type: Boolean, default: true },
      qrOrdering:     { type: Boolean, default: true },
      expenses:       { type: Boolean, default: true },
      reports:        { type: Boolean, default: true },
      tables:         { type: Boolean, default: true },
      ingredients:    { type: Boolean, default: false },
      waste:          { type: Boolean, default: false },
      aggregator:     { type: Boolean, default: false },
    },

    // Legacy premium fields (backwards compat)
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
