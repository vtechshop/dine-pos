import mongoose, { Schema, Document, Types } from 'mongoose';

// ── Loyalty settings sub-document (Architecture v1.1) ───────────────────────
export interface ILoyaltySettings {
  rewardName: string;               // display name: "Points", "Stars", "Coins"
  pointsPerHundredRupees: number;   // earn rate e.g. 10 = earn 10 pts per ₹100
  minimumRedeemPoints: number;      // floor for redemption
  maximumRedeemPercent: number;     // max % of bill that can be paid via points
  pointValueInPaisa: number;        // 100 = 1 point equals ₹1
  expiryDays: number;               // 0 = never expires
  roundingRule: 'floor' | 'round' | 'ceil';
  calculationBase: 'before_gst' | 'after_gst';
}

export interface ISettings extends Document {
  hotelId: Types.ObjectId;
  hotelName: string;
  address: string;
  phone: string;
  email: string;
  // Owner & Legal
  ownerName: string;
  fssaiNumber: string;
  panNumber: string;
  businessType: 'veg' | 'non-veg' | 'both';
  // Bank
  bankName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  bankAccountHolder: string;
  upiId: string;
  // Tax & config
  gstNumber: string;
  defaultTaxPercent: number;
  currency: string;
  currencySymbol: string;
  printerWidth: '58mm' | '80mm';
  footerText: string;
  isSetupComplete: boolean;
  kitchenPin: string;
  // ── Printer Architecture (Architecture v1.1) ────────────────────────────
  printerMode: 'single' | 'dual';
  kitchenPrinterAddress: string;   // Bluetooth MAC for KOT in dual mode
  cashierPrinterAddress: string;   // Bluetooth MAC for receipts in dual mode
  kotAutoPrint: boolean;           // KitchenDisplay auto-prints KOT on new_order
  // ── QR Session Timeout (Architecture v1.1) ──────────────────────────────
  qrGuestTimeoutMinutes: number;   // idle QR guests expire after this many minutes
  // ── Loyalty (Architecture v1.1) ─────────────────────────────────────────
  loyaltySettings: ILoyaltySettings;
  updatedAt: Date;
}

const SettingsSchema: Schema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', unique: true, sparse: true },
    hotelName: {
      type: String,
      default: 'My Hotel',
    },
    address: {
      type: String,
      default: '',
    },
    phone: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      default: '',
    },
    ownerName: {
      type: String,
      default: '',
    },
    fssaiNumber: {
      type: String,
      default: '',
    },
    panNumber: {
      type: String,
      default: '',
    },
    businessType: {
      type: String,
      enum: ['veg', 'non-veg', 'both'],
      default: 'both',
    },
    bankName: {
      type: String,
      default: '',
    },
    bankAccountNumber: {
      type: String,
      default: '',
    },
    bankIfscCode: {
      type: String,
      default: '',
    },
    bankAccountHolder: {
      type: String,
      default: '',
    },
    upiId: {
      type: String,
      default: '',
    },
    gstNumber: {
      type: String,
      default: '',
    },
    isSetupComplete: {
      type: Boolean,
      default: false,
    },
    defaultTaxPercent: {
      type: Number,
      default: 5,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    currencySymbol: {
      type: String,
      default: '₹',
    },
    printerWidth: {
      type: String,
      enum: ['58mm', '80mm'],
      default: '80mm',
    },
    footerText: {
      type: String,
      default: 'Thank you! Visit again!',
    },
    kitchenPin: {
      type: String,
      default: '',
    },
    roleImageAdmin: { type: String, default: '' },
    roleImageCustomer: { type: String, default: '' },
    roleImageStaff: { type: String, default: '' },

    // ── Printer Architecture (Architecture v1.1) ──────────────────────────
    printerMode:            { type: String, enum: ['single', 'dual'], default: 'single' },
    kitchenPrinterAddress:  { type: String, default: '' },
    cashierPrinterAddress:  { type: String, default: '' },
    kotAutoPrint:           { type: Boolean, default: false },

    // ── QR Session Timeout (Architecture v1.1) ────────────────────────────
    qrGuestTimeoutMinutes:  { type: Number, default: 15, min: 1, max: 60 },

    // ── Loyalty Settings (Architecture v1.1) ─────────────────────────────
    loyaltySettings: {
      rewardName:               { type: String, default: 'Points', maxlength: 30 },
      pointsPerHundredRupees:   { type: Number, default: 10, min: 0 },
      minimumRedeemPoints:      { type: Number, default: 100, min: 0 },
      maximumRedeemPercent:     { type: Number, default: 10, min: 0, max: 100 },
      pointValueInPaisa:        { type: Number, default: 100, min: 1 },
      expiryDays:               { type: Number, default: 0, min: 0 },
      roundingRule:             { type: String, enum: ['floor', 'round', 'ceil'], default: 'floor' },
      calculationBase:          { type: String, enum: ['before_gst', 'after_gst'], default: 'before_gst' },
    },
  },
  { timestamps: true }
);

export default mongoose.model<ISettings>('Settings', SettingsSchema);
