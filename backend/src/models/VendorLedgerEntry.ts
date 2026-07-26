import mongoose, { Document, Schema } from 'mongoose';

export type LedgerEntryType =
  | 'purchase'
  | 'grn'
  | 'payment'
  | 'debit_note'
  | 'credit_note'
  | 'opening_balance'
  | 'adjustment';

export interface IVendorLedgerEntry extends Document {
  hotelId:         mongoose.Types.ObjectId;
  vendorId:        mongoose.Types.ObjectId;
  entryType:       LedgerEntryType;
  referenceId:     mongoose.Types.ObjectId | null;
  referenceNumber: string;
  debit:           number;
  credit:          number;
  runningBalance:  number;
  description:     string;
  createdAt:       Date;
  updatedAt:       Date;
}

const VendorLedgerEntrySchema = new Schema<IVendorLedgerEntry>(
  {
    hotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    entryType: {
      type:     String,
      enum:     ['purchase', 'grn', 'payment', 'debit_note', 'credit_note', 'opening_balance', 'adjustment'],
      required: true,
    },
    referenceId:     { type: Schema.Types.ObjectId, default: null },
    referenceNumber: { type: String, default: '', trim: true },
    debit:           { type: Number, default: 0, min: 0 },
    credit:          { type: Number, default: 0, min: 0 },
    runningBalance:  { type: Number, default: 0 },
    description:     { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

VendorLedgerEntrySchema.index({ hotelId: 1, vendorId: 1, createdAt: -1 });
VendorLedgerEntrySchema.index({ hotelId: 1, entryType: 1, createdAt: -1 });
VendorLedgerEntrySchema.index({ hotelId: 1, referenceId: 1 });

export default mongoose.model<IVendorLedgerEntry>('VendorLedgerEntry', VendorLedgerEntrySchema);
