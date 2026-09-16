import mongoose, { Schema, Document } from 'mongoose';

export type VoucherTxType = 'issue' | 'redeem' | 'topup' | 'expire' | 'refund';

export interface IVoucherTransaction {
  type:      VoucherTxType;
  amount:    number;
  balanceAfter: number;
  orderId:   mongoose.Types.ObjectId | null;
  remarks:   string;
  createdBy: string;
  createdAt: Date;
}

export interface IGiftVoucher extends Document {
  hotelId:            mongoose.Types.ObjectId;
  voucherCode:        string;
  originalAmount:     number;
  balance:            number;
  issuedToCustomerId: mongoose.Types.ObjectId | null;
  issuedToName:       string;
  issuedToPhone:      string;
  issuedAt:           Date;
  expiresAt:          Date | null;
  isActive:           boolean;
  isDeleted:          boolean;
  transactions:       IVoucherTransaction[];
  createdBy:          string;
  scope:              'branch' | 'organization';
  orgHotelId:         mongoose.Types.ObjectId | null;
  createdAt:          Date;
  updatedAt:          Date;
}

const VoucherTransactionSchema = new Schema<IVoucherTransaction>(
  {
    type:         { type: String, enum: ['issue', 'redeem', 'topup', 'expire', 'refund'], required: true },
    amount:       { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    orderId:      { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    remarks:      { type: String, default: '' },
    createdBy:    { type: String, default: 'system' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, _id: true },
);

const GiftVoucherSchema = new Schema<IGiftVoucher>(
  {
    hotelId:            { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    voucherCode:        { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    originalAmount:     { type: Number, required: true, min: 0 },
    balance:            { type: Number, required: true, min: 0 },
    issuedToCustomerId: { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
    issuedToName:       { type: String, default: '' },
    issuedToPhone:      { type: String, default: '' },
    issuedAt:           { type: Date, default: () => new Date() },
    expiresAt:          { type: Date, default: null },
    isActive:           { type: Boolean, default: true },
    isDeleted:          { type: Boolean, default: false },
    transactions:       [VoucherTransactionSchema],
    createdBy:          { type: String, default: '' },
    scope:              { type: String, enum: ['branch', 'organization'], default: 'branch' },
    orgHotelId:         { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
  },
  { timestamps: true },
);

GiftVoucherSchema.index({ hotelId: 1, voucherCode: 1 }, { unique: true });
GiftVoucherSchema.index({ hotelId: 1, isActive: 1, balance: -1 });
GiftVoucherSchema.index({ issuedToCustomerId: 1 }, { sparse: true });
GiftVoucherSchema.index({ expiresAt: 1 }, { sparse: true });
// Org-scoped voucher lookup: sparse so null orgHotelId (branch vouchers) doesn't bloat the index
GiftVoucherSchema.index({ orgHotelId: 1, scope: 1, voucherCode: 1 }, { sparse: true });

export default mongoose.model<IGiftVoucher>('GiftVoucher', GiftVoucherSchema);
