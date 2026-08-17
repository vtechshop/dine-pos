import mongoose, { Schema, Document } from 'mongoose';

export type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface IPOItem {
  productId?: mongoose.Types.ObjectId;
  productName: string;
  variantId: string;
  variantName: string;
  orderedQty: number;
  receivedQty: number;
  returnedQty?: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxPercent: number;
  lineTotal: number;
  notes: string;
}

export interface IPurchaseOrder extends Document {
  hotelId:              mongoose.Types.ObjectId;
  poNumber:             string;
  vendorId:             mongoose.Types.ObjectId;
  vendorSnapshot: {
    businessName: string;
    vendorCode:   string;
    mobile:       string;
    gstNumber:    string;
  };
  status:               POStatus;
  orderDate:            Date;
  expectedDeliveryDate: Date | null;
  currency:             string;
  notes:                string;
  items:                IPOItem[];
  subtotal:             number;
  taxTotal:             number;
  discount:             number;
  tax:                  number;
  shipping:             number;
  total:                number;
  createdBy:            string;
  updatedBy:            string;
  approvedBy:           string;
  approvedAt:           Date | null;
  cancelReason:         string;
  isDeleted:            boolean;
}

const POItemSchema = new Schema<IPOItem>(
  {
    productId:   { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, required: true, trim: true },
    variantId:   { type: String, default: '' },
    variantName: { type: String, default: '' },
    orderedQty:  { type: Number, required: true, min: 0.001 },
    receivedQty: { type: Number, default: 0, min: 0 },
    returnedQty: { type: Number, default: 0, min: 0 },
    unit:        { type: String, default: 'pcs', trim: true },
    unitPrice:   { type: Number, required: true, min: 0 },
    discount:    { type: Number, default: 0, min: 0 },
    taxPercent:  { type: Number, default: 0, min: 0 },
    lineTotal:   { type: Number, default: 0, min: 0 },
    notes:       { type: String, default: '', trim: true },
  },
  { _id: true },
);

const PurchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    hotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    poNumber: { type: String, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorSnapshot: {
      businessName: { type: String, default: '' },
      vendorCode:   { type: String, default: '' },
      mobile:       { type: String, default: '' },
      gstNumber:    { type: String, default: '' },
    },
    status: {
      type:    String,
      enum:    ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'cancelled'],
      default: 'draft',
    },
    orderDate:            { type: Date, default: () => new Date() },
    expectedDeliveryDate: { type: Date, default: null },
    currency:             { type: String, default: 'INR', trim: true },
    notes:                { type: String, default: '', trim: true },
    items:                { type: [POItemSchema], default: [] },
    subtotal:             { type: Number, default: 0, min: 0 },
    taxTotal:             { type: Number, default: 0, min: 0 },
    discount:             { type: Number, default: 0, min: 0 },
    tax:                  { type: Number, default: 0, min: 0 },
    shipping:             { type: Number, default: 0, min: 0 },
    total:                { type: Number, default: 0, min: 0 },
    createdBy:            { type: String, default: '' },
    updatedBy:            { type: String, default: '' },
    approvedBy:           { type: String, default: '' },
    approvedAt:           { type: Date, default: null },
    cancelReason:         { type: String, default: '', trim: true },
    isDeleted:            { type: Boolean, default: false },
  },
  { timestamps: true },
);

PurchaseOrderSchema.index({ hotelId: 1, isDeleted: 1, status: 1 });
PurchaseOrderSchema.index({ hotelId: 1, poNumber: 1 }, { unique: true });
PurchaseOrderSchema.index({ hotelId: 1, vendorId: 1, isDeleted: 1 });
PurchaseOrderSchema.index({ hotelId: 1, orderDate: -1, isDeleted: 1 });

export default mongoose.model<IPurchaseOrder>('PurchaseOrder', PurchaseOrderSchema);
