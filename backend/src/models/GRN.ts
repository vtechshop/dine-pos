import mongoose, { Document, Schema } from 'mongoose';

export type GRNStatus = 'pending' | 'partial' | 'completed' | 'cancelled';

export interface IGRNItem {
  poItemIndex?:      number;
  productId?:        mongoose.Types.ObjectId;
  ingredientId?:     mongoose.Types.ObjectId;
  productName:       string;
  variantId?:        string;
  variantName?:      string;
  orderedQty:        number;
  receivedQty:       number;
  damagedQty:        number;
  rejectedQty:       number;
  pendingQty:        number;
  returnedQty?:      number;
  unit:              string;
  purchasePrice:     number;
  prevCostPerUnit?:  number;  // WAC before this GRN was received — used to reverse WAC on cancellation
  batchNumber?:      string;
  manufacturingDate?: Date;
  expiryDate?:       Date;
  warehouse?:        string;
  notes?:            string;
}

export interface IGRN extends Document {
  hotelId:         mongoose.Types.ObjectId;
  grnNumber:       string;
  poId:            mongoose.Types.ObjectId;
  poNumber:        string;
  vendorId:        mongoose.Types.ObjectId;
  vendorSnapshot:  { businessName: string; vendorCode: string; mobile: string; gstNumber: string };
  receiveDate:     Date;
  status:          GRNStatus;
  items:           IGRNItem[];
  notes:           string;
  receivedBy:      string;
  cancelReason:    string;
  isDeleted:       boolean;
  idempotencyKey?: string;
  createdAt:       Date;
  updatedAt:       Date;
}

const GRNItemSchema = new Schema<IGRNItem>(
  {
    poItemIndex:      { type: Number },
    productId:        { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    ingredientId:     { type: Schema.Types.ObjectId, ref: 'Ingredient', default: null },
    productName:      { type: String, required: true, trim: true },
    variantId:        { type: String, default: '' },
    variantName:      { type: String, default: '' },
    orderedQty:       { type: Number, default: 0, min: 0 },
    receivedQty:      { type: Number, required: true, min: 0 },
    damagedQty:       { type: Number, default: 0, min: 0 },
    rejectedQty:      { type: Number, default: 0, min: 0 },
    pendingQty:       { type: Number, default: 0, min: 0 },
    returnedQty:      { type: Number, default: 0, min: 0 },
    unit:             { type: String, default: 'pcs', trim: true },
    purchasePrice:    { type: Number, default: 0, min: 0 },
    prevCostPerUnit:  { type: Number, default: null },
    batchNumber:      { type: String, default: '', trim: true },
    manufacturingDate: { type: Date, default: null },
    expiryDate:       { type: Date, default: null },
    warehouse:        { type: String, default: '', trim: true },
    notes:            { type: String, default: '', trim: true },
  },
  { _id: true },
);

const GRNSchema = new Schema<IGRN>(
  {
    hotelId:    { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    grnNumber:  { type: String, required: true },
    poId:       { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    poNumber:   { type: String, required: true },
    vendorId:   { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorSnapshot: {
      businessName: { type: String, default: '' },
      vendorCode:   { type: String, default: '' },
      mobile:       { type: String, default: '' },
      gstNumber:    { type: String, default: '' },
    },
    receiveDate:  { type: Date, default: Date.now },
    status:       { type: String, enum: ['pending', 'partial', 'completed', 'cancelled'], default: 'pending' },
    items:        { type: [GRNItemSchema], default: [] },
    notes:          { type: String, default: '', trim: true },
    receivedBy:     { type: String, default: '' },
    cancelReason:   { type: String, default: '' },
    isDeleted:      { type: Boolean, default: false },
    idempotencyKey: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

GRNSchema.index({ hotelId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
GRNSchema.index({ hotelId: 1, isDeleted: 1, status: 1 });
GRNSchema.index({ hotelId: 1, grnNumber: 1 }, { unique: true });
GRNSchema.index({ hotelId: 1, poId: 1, isDeleted: 1 });
GRNSchema.index({ hotelId: 1, vendorId: 1, isDeleted: 1 });
GRNSchema.index({ hotelId: 1, receiveDate: -1, isDeleted: 1 });

export default mongoose.model<IGRN>('GRN', GRNSchema);
