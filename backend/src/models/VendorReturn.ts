import mongoose, { Schema, Document } from 'mongoose';

export type VendorReturnStatus = 'draft' | 'approved' | 'completed' | 'cancelled';

export interface IVendorReturnItem {
  grnItemIndex:  number;        // 0-based index into grn.items
  ingredientId?: mongoose.Types.ObjectId;
  productName:   string;        // snapshot
  unit:          string;        // snapshot
  purchasePrice: number;        // snapshot from GRN item
  returnQty:     number;        // qty to return (> 0)
  reason:        string;
  notes?:        string;
}

export interface IVendorReturn extends Document {
  hotelId:        mongoose.Types.ObjectId;
  returnNumber:   string;
  vendorId:       mongoose.Types.ObjectId;
  vendorSnapshot: { businessName: string; vendorCode: string; mobile: string };
  poId:           mongoose.Types.ObjectId;
  poNumber:       string;
  grnId:          mongoose.Types.ObjectId;
  grnNumber:      string;
  status:         VendorReturnStatus;
  items:          IVendorReturnItem[];
  returnValue:    number;
  notes:          string;
  createdBy:      string;
  approvedBy:     string;
  approvedAt:     Date | null;
  completedBy:    string;
  completedAt:    Date | null;
  cancelledBy:    string;
  cancelledAt:    Date | null;
  cancelReason:   string;
  isDeleted:      boolean;
  idempotencyKey?: string;
  createdAt:      Date;
  updatedAt:      Date;
}

const VendorReturnItemSchema = new Schema<IVendorReturnItem>(
  {
    grnItemIndex:  { type: Number, required: true, min: 0 },
    ingredientId:  { type: Schema.Types.ObjectId, ref: 'Ingredient', default: null },
    productName:   { type: String, required: true, trim: true },
    unit:          { type: String, default: 'pcs', trim: true },
    purchasePrice: { type: Number, default: 0, min: 0 },
    returnQty:     { type: Number, required: true, min: 0.001 },
    reason:        { type: String, default: '', trim: true },
    notes:         { type: String, default: '', trim: true },
  },
  { _id: true },
);

const VendorReturnSchema = new Schema<IVendorReturn>(
  {
    hotelId:      { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    returnNumber: { type: String, required: true },
    vendorId:     { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorSnapshot: {
      businessName: { type: String, default: '' },
      vendorCode:   { type: String, default: '' },
      mobile:       { type: String, default: '' },
    },
    poId:     { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    poNumber: { type: String, required: true },
    grnId:    { type: Schema.Types.ObjectId, ref: 'GRN', required: true },
    grnNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'approved', 'completed', 'cancelled'],
      default: 'draft',
    },
    items:       { type: [VendorReturnItemSchema], default: [] },
    returnValue: { type: Number, default: 0, min: 0 },
    notes:       { type: String, default: '', trim: true },
    createdBy:   { type: String, default: '' },
    approvedBy:  { type: String, default: '' },
    approvedAt:  { type: Date, default: null },
    completedBy: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '', trim: true },
    isDeleted:    { type: Boolean, default: false },
    idempotencyKey: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

VendorReturnSchema.index({ hotelId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
VendorReturnSchema.index({ hotelId: 1, returnNumber: 1 }, { unique: true });
VendorReturnSchema.index({ hotelId: 1, isDeleted: 1, status: 1 });
VendorReturnSchema.index({ hotelId: 1, vendorId: 1, isDeleted: 1 });
VendorReturnSchema.index({ hotelId: 1, grnId: 1, isDeleted: 1 });
VendorReturnSchema.index({ hotelId: 1, createdAt: -1 });

export default mongoose.model<IVendorReturn>('VendorReturn', VendorReturnSchema);
