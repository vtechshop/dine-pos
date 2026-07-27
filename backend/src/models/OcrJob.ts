import mongoose, { Schema, Document } from 'mongoose';

export type OcrJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'approved'
  | 'rejected';

export interface IExtractedItem {
  productName:  string;
  quantity:     number;
  unit:         string;
  unitPrice:    number;
  taxPercent:   number;
  lineTotal:    number;
  ingredientId: string | null; // user-linked during review
}

export interface IExtractedInvoice {
  vendorName:    string;
  invoiceNumber: string;
  invoiceDate:   string; // raw string from OCR; may be YYYY-MM-DD or localized
  gstNumber:     string;
  items:         IExtractedItem[];
  subtotal:      number;
  taxTotal:      number;
  totalAmount:   number;
  cleanupNotes:  string; // Gemini's notes on corrections applied
}

export interface IVendorMatch {
  vendorId:     string;
  businessName: string;
  gstNumber:    string;
  confidence:   number; // 0-1
}

export interface IDuplicateWarning {
  isDuplicate:   boolean;
  matchedJobId:  string | null;
  matchedPoId:   string | null;
  reason:        string;
}

export interface IOcrJob extends Document {
  hotelId:       mongoose.Types.ObjectId;
  status:        OcrJobStatus;

  // Uploaded file (cleared after OCR to free space)
  fileName:      string;
  fileType:      'pdf' | 'jpg' | 'png';
  fileSizeBytes: number;
  fileMimeType:  string; // actual MIME for Gemini inline data
  fileData:      string; // base64 — cleared after OCR worker runs

  // OCR result (set by worker)
  extractedData:   IExtractedInvoice | null;
  matchedVendors:  IVendorMatch[];
  duplicateWarning: IDuplicateWarning | null;

  // User review (set by PUT /review before approval)
  reviewedData:    IExtractedInvoice | null;
  selectedVendorId: string | null;

  // Approval result
  createdPoId:   string | null;
  createdGrnId:  string | null;
  approvedBy:    string | null;
  approvedAt:    Date | null;

  // Failure detail
  errorMessage:  string | null;

  createdAt: Date;
  updatedAt: Date;
}

const ExtractedItemSchema = new Schema<IExtractedItem>(
  {
    productName:  { type: String, default: '' },
    quantity:     { type: Number, default: 0 },
    unit:         { type: String, default: 'pcs' },
    unitPrice:    { type: Number, default: 0 },
    taxPercent:   { type: Number, default: 0 },
    lineTotal:    { type: Number, default: 0 },
    ingredientId: { type: String, default: null },
  },
  { _id: false },
);

const ExtractedInvoiceSchema = new Schema<IExtractedInvoice>(
  {
    vendorName:    { type: String, default: '' },
    invoiceNumber: { type: String, default: '' },
    invoiceDate:   { type: String, default: '' },
    gstNumber:     { type: String, default: '' },
    items:         { type: [ExtractedItemSchema], default: [] },
    subtotal:      { type: Number, default: 0 },
    taxTotal:      { type: Number, default: 0 },
    totalAmount:   { type: Number, default: 0 },
    cleanupNotes:  { type: String, default: '' },
  },
  { _id: false },
);

const VendorMatchSchema = new Schema<IVendorMatch>(
  {
    vendorId:     { type: String, required: true },
    businessName: { type: String, default: '' },
    gstNumber:    { type: String, default: '' },
    confidence:   { type: Number, default: 0 },
  },
  { _id: false },
);

const DuplicateWarningSchema = new Schema<IDuplicateWarning>(
  {
    isDuplicate:   { type: Boolean, default: false },
    matchedJobId:  { type: String, default: null },
    matchedPoId:   { type: String, default: null },
    reason:        { type: String, default: '' },
  },
  { _id: false },
);

const OcrJobSchema = new Schema<IOcrJob>(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    status:         { type: String, enum: ['pending','processing','completed','failed','approved','rejected'], default: 'pending', index: true },

    fileName:       { type: String, default: '' },
    fileType:       { type: String, enum: ['pdf','jpg','png'], required: true },
    fileSizeBytes:  { type: Number, default: 0 },
    fileMimeType:   { type: String, default: '' },
    fileData:       { type: String, default: '' }, // cleared after OCR

    extractedData:   { type: ExtractedInvoiceSchema, default: null },
    matchedVendors:  { type: [VendorMatchSchema], default: [] },
    duplicateWarning: { type: DuplicateWarningSchema, default: null },

    reviewedData:    { type: ExtractedInvoiceSchema, default: null },
    selectedVendorId: { type: String, default: null },

    createdPoId:   { type: String, default: null },
    createdGrnId:  { type: String, default: null },
    approvedBy:    { type: String, default: null },
    approvedAt:    { type: Date, default: null },

    errorMessage:  { type: String, default: null },
  },
  { timestamps: true },
);

// Hotel + status index for worker polling
OcrJobSchema.index({ hotelId: 1, status: 1, createdAt: -1 });

// Auto-expire completed/approved/failed/rejected jobs after 30 days
OcrJobSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model<IOcrJob>('OcrJob', OcrJobSchema);
