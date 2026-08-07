import mongoose, { Schema, Document } from 'mongoose';

export type WalletTxType = 'credit' | 'debit';
export type WalletTxSource = 'topup' | 'redemption' | 'refund' | 'adjustment' | 'expiry';

export interface IWalletTransaction extends Document {
  hotelId:       mongoose.Types.ObjectId;
  customerId:    mongoose.Types.ObjectId;
  type:          WalletTxType;
  source:        WalletTxSource;
  amount:        number;
  balanceAfter:  number;
  orderId:       mongoose.Types.ObjectId | null;
  paymentRef:    string;
  remarks:       string;
  createdBy:     string;
  createdAt:     Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    hotelId:      { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    customerId:   { type: Schema.Types.ObjectId, ref: 'CustomerProfile', required: true, index: true },
    type:         { type: String, enum: ['credit', 'debit'], required: true },
    source:       { type: String, enum: ['topup', 'redemption', 'refund', 'adjustment', 'expiry'], required: true },
    amount:       { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    orderId:      { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    paymentRef:   { type: String, default: '' },
    remarks:      { type: String, default: '', maxlength: 500 },
    createdBy:    { type: String, default: 'system', maxlength: 100 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

WalletTransactionSchema.index({ customerId: 1, createdAt: -1 });
WalletTransactionSchema.index({ hotelId: 1, createdAt: -1 });
WalletTransactionSchema.index({ orderId: 1 }, { sparse: true });

export default mongoose.model<IWalletTransaction>('WalletTransaction', WalletTransactionSchema);
