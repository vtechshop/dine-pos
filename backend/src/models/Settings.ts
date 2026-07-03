import mongoose, { Schema, Document, Types } from 'mongoose';

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
  },
  { timestamps: true }
);

export default mongoose.model<ISettings>('Settings', SettingsSchema);
