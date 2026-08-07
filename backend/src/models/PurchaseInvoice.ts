import mongoose, { Schema, Document } from 'mongoose';

export type InvoiceStatus = 'draft' | 'verified' | 'paid' | 'cancelled';

export interface IInvoiceAttachment {
  filename: string;
  url:      string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface IPurchaseInvoice extends Document {
  hotelId:        mongoose.Types.ObjectId;
  invoiceNumber:  string;
  vendorInvoiceNo: string;       // Vendor's own invoice number
  invoiceDate:    Date;
  vendorId:       mongoose.Types.ObjectId;
  vendorSnapshot: {
    businessName: string;
    gstNumber:    string;
    pan:          string;
    vendorCode:   string;
  };
  grnIds:    mongoose.Types.ObjectId[];
  grnNumbers: string[];
  // Financials
  subtotal:      number;
  taxBreakup:    { label: string; rate: number; amount: number }[];
  taxTotal:      number;
  freight:       number;
  otherCharges:  number;
  discount:      number;
  grandTotal:    number;
  // Status
  status:        InvoiceStatus;
  notes:         string;
  attachments:   IInvoiceAttachment[];
  // Audit
  verifiedBy:    string;
  verifiedAt:    Date | null;
  paidAt:        Date | null;
  paymentRef:    string;
  cancelReason:  string;
  isDeleted:     boolean;
  createdBy:     string;
  createdAt:     Date;
  updatedAt:     Date;
}

const InvoiceAttachmentSchema = new Schema<IInvoiceAttachment>(
  {
    filename:   { type: String, required: true },
    url:        { type: String, required: true },
    fileSize:   { type: Number, default: 0 },
    mimeType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: () => new Date() },
    uploadedBy: { type: String, default: '' },
  },
  { _id: true },
);

const PurchaseInvoiceSchema = new Schema<IPurchaseInvoice>(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    invoiceNumber:    { type: String, required: true },
    vendorInvoiceNo:  { type: String, default: '', trim: true },
    invoiceDate:      { type: Date, required: true },
    vendorId:         { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorSnapshot: {
      businessName: { type: String, default: '' },
      gstNumber:    { type: String, default: '' },
      pan:          { type: String, default: '' },
      vendorCode:   { type: String, default: '' },
    },
    grnIds:     [{ type: Schema.Types.ObjectId, ref: 'GRN' }],
    grnNumbers: [{ type: String }],
    subtotal:     { type: Number, required: true, min: 0 },
    taxBreakup:   [{
      label:  { type: String, default: '' },
      rate:   { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
    }],
    taxTotal:     { type: Number, default: 0, min: 0 },
    freight:      { type: Number, default: 0, min: 0 },
    otherCharges: { type: Number, default: 0, min: 0 },
    discount:     { type: Number, default: 0, min: 0 },
    grandTotal:   { type: Number, required: true, min: 0 },
    status:       { type: String, enum: ['draft', 'verified', 'paid', 'cancelled'], default: 'draft' },
    notes:        { type: String, default: '', maxlength: 1000 },
    attachments:  [InvoiceAttachmentSchema],
    verifiedBy:   { type: String, default: '' },
    verifiedAt:   { type: Date, default: null },
    paidAt:       { type: Date, default: null },
    paymentRef:   { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    isDeleted:    { type: Boolean, default: false },
    createdBy:    { type: String, default: '' },
  },
  { timestamps: true },
);

PurchaseInvoiceSchema.index({ hotelId: 1, invoiceNumber: 1 }, { unique: true });
PurchaseInvoiceSchema.index({ hotelId: 1, vendorId: 1, invoiceDate: -1 });
PurchaseInvoiceSchema.index({ hotelId: 1, status: 1, invoiceDate: -1 });

export default mongoose.model<IPurchaseInvoice>('PurchaseInvoice', PurchaseInvoiceSchema);
