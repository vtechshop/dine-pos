import mongoose, { Document, Schema } from 'mongoose';

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'card';

export interface IVendorPayment extends Document {
  hotelId:         mongoose.Types.ObjectId;
  paymentNumber:   string;
  vendorId:        mongoose.Types.ObjectId;
  vendorSnapshot:  { businessName: string; vendorCode: string; mobile: string };
  paymentDate:     Date;
  paymentMethod:   PaymentMethod;
  amount:          number;
  referenceNumber: string;
  notes:           string;
  attachment:      string;
  createdBy:       string;
  approvedBy:      string;
  isReversed:      boolean;
  reversedBy:      string;
  reversedAt:      Date | null;
  reversalReason:  string;
  isDeleted:       boolean;
  createdAt:       Date;
  updatedAt:       Date;
}

const VendorPaymentSchema = new Schema<IVendorPayment>(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    paymentNumber: { type: String, required: true },
    vendorId:      { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorSnapshot: {
      businessName: { type: String, default: '' },
      vendorCode:   { type: String, default: '' },
      mobile:       { type: String, default: '' },
    },
    paymentDate:    { type: Date, default: () => new Date() },
    paymentMethod:  {
      type:     String,
      enum:     ['cash', 'upi', 'bank_transfer', 'cheque', 'card'],
      required: true,
    },
    amount:          { type: Number, required: true, min: 0.01 },
    referenceNumber: { type: String, default: '', trim: true },
    notes:           { type: String, default: '', trim: true },
    attachment:      { type: String, default: '', trim: true },
    createdBy:       { type: String, default: '' },
    approvedBy:      { type: String, default: '' },
    isReversed:      { type: Boolean, default: false },
    reversedBy:      { type: String, default: '' },
    reversedAt:      { type: Date, default: null },
    reversalReason:  { type: String, default: '', trim: true },
    isDeleted:       { type: Boolean, default: false },
  },
  { timestamps: true },
);

VendorPaymentSchema.index({ hotelId: 1, isDeleted: 1, paymentDate: -1 });
VendorPaymentSchema.index({ hotelId: 1, vendorId: 1, isDeleted: 1 });
VendorPaymentSchema.index({ hotelId: 1, paymentNumber: 1 }, { unique: true });
VendorPaymentSchema.index({ hotelId: 1, isReversed: 1, isDeleted: 1 });

export default mongoose.model<IVendorPayment>('VendorPayment', VendorPaymentSchema);
