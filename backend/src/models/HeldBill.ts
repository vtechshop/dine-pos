import mongoose, { Schema, Document } from 'mongoose';

export interface IHeldBill extends Document {
  hotelId: mongoose.Types.ObjectId;
  cashierId: string;
  cashierName?: string;
  label?: string;
  items: any[];
  metadata: {
    orderType?: string;
    tableId?: string;
    tableNumber?: string;
    tableName?: string;
    customerName?: string;
    customerPhone?: string;
    deliveryAddress?: string;
    deliveryCharge?: number;
    discountAmount?: number;
    discountType?: string;
    couponCode?: string;
    voucherCode?: string;
    loyaltyPoints?: number;
    loyaltyDiscount?: number;
    notes?: string;
  };
  heldAt: Date;
  terminal?: string;
}

const heldBillSchema = new Schema<IHeldBill>({
  hotelId:     { type: Schema.Types.ObjectId, required: true, index: true },
  cashierId:   { type: String, required: true },
  cashierName: { type: String },
  label:       { type: String },
  items:       { type: Schema.Types.Mixed, required: true },
  metadata:    { type: Schema.Types.Mixed, default: {} },
  heldAt:      { type: Date, default: Date.now },
  terminal:    { type: String },
}, { timestamps: true });

// Auto-expire after 24 hours
heldBillSchema.index({ heldAt: 1 }, { expireAfterSeconds: 86400 });

export const HeldBill = mongoose.model<IHeldBill>('HeldBill', heldBillSchema);
export default HeldBill;
