import mongoose, { Schema, Document } from 'mongoose';

export type PaymentTerms = 'immediate' | 'net15' | 'net30' | 'net45' | 'net60' | 'custom';

export interface IVendor extends Document {
  hotelId:            mongoose.Types.ObjectId;
  vendorCode:         string;
  businessName:       string;
  contactPerson:      string;
  mobile:             string;
  alternateMobile:    string;
  email:              string;
  gstNumber:          string;
  pan:                string;
  address:            string;
  city:               string;
  state:              string;
  pincode:            string;
  paymentTerms:       PaymentTerms;
  creditLimit:        number;
  openingBalance:     number;
  currentOutstanding: number;
  notes:              string;
  isActive:           boolean;
  isDeleted:          boolean;
  createdBy:          string;
  updatedBy:          string;
}

const VendorSchema = new Schema<IVendor>(
  {
    hotelId:            { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    vendorCode:         { type: String, required: true },
    businessName:       { type: String, required: true, trim: true },
    contactPerson:      { type: String, default: '', trim: true },
    mobile:             { type: String, required: true, trim: true },
    alternateMobile:    { type: String, default: '', trim: true },
    email:              { type: String, default: '', trim: true, lowercase: true },
    gstNumber:          { type: String, default: '', trim: true, uppercase: true },
    pan:                { type: String, default: '', trim: true, uppercase: true },
    address:            { type: String, default: '', trim: true },
    city:               { type: String, default: '', trim: true },
    state:              { type: String, default: '', trim: true },
    pincode:            { type: String, default: '', trim: true },
    paymentTerms:       {
      type:    String,
      enum:    ['immediate', 'net15', 'net30', 'net45', 'net60', 'custom'],
      default: 'immediate',
    },
    creditLimit:        { type: Number, default: 0, min: 0 },
    openingBalance:     { type: Number, default: 0 },
    currentOutstanding: { type: Number, default: 0 },
    notes:              { type: String, default: '', trim: true },
    isActive:           { type: Boolean, default: true },
    isDeleted:          { type: Boolean, default: false },
    createdBy:          { type: String, default: '' },
    updatedBy:          { type: String, default: '' },
  },
  { timestamps: true },
);

VendorSchema.index({ hotelId: 1, isDeleted: 1, businessName: 1 });
VendorSchema.index({ hotelId: 1, vendorCode: 1 }, { unique: true });

export default mongoose.model<IVendor>('Vendor', VendorSchema);
