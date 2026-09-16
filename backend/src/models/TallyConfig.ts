import mongoose, { Schema, Document } from 'mongoose';

export interface ITallyLedgerMap {
  salesLedger:       string;
  cgstLedger:        string;
  sgstLedger:        string;
  cashLedger:        string;
  bankLedger:        string;
  discountLedger:    string;
  roundOffLedger:    string;
  expenseLedger:     string;
  purchaseLedger:    string;
  stockInHandLedger: string;
  walletLedger:      string;
}

export interface ITallyConfig extends Document {
  hotelId:             mongoose.Types.ObjectId;
  enabled:             boolean;
  companyName:         string;
  connectorToken:      string;      // AES-256-GCM encrypted; NEVER returned to frontend
  connectorLastSeenAt: Date | null;
  ledgerMap:           ITallyLedgerMap;
  syncSales:           boolean;
  syncPurchases:       boolean;
  syncExpenses:        boolean;
  syncCancellations:   boolean;
  createdAt:           Date;
  updatedAt:           Date;
}

const TallyLedgerMapSchema = new Schema<ITallyLedgerMap>(
  {
    salesLedger:       { type: String, default: 'Sales' },
    cgstLedger:        { type: String, default: 'Output CGST' },
    sgstLedger:        { type: String, default: 'Output SGST' },
    cashLedger:        { type: String, default: 'Cash' },
    bankLedger:        { type: String, default: 'Bank' },
    discountLedger:    { type: String, default: 'Discount Allowed' },
    roundOffLedger:    { type: String, default: 'Round Off' },
    expenseLedger:     { type: String, default: 'Indirect Expenses' },
    purchaseLedger:    { type: String, default: 'Purchases' },
    stockInHandLedger: { type: String, default: 'Stock-in-Hand' },
    walletLedger:      { type: String, default: 'Customer Wallet' },
  },
  { _id: false },
);

const TallyConfigSchema: Schema = new Schema(
  {
    hotelId:             { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    enabled:             { type: Boolean, default: false },
    companyName:         { type: String, default: '' },
    connectorToken:      { type: String, default: '' },
    connectorLastSeenAt: { type: Date, default: null },
    ledgerMap:           { type: TallyLedgerMapSchema, default: () => ({}) },
    syncSales:           { type: Boolean, default: true },
    syncPurchases:       { type: Boolean, default: true },
    syncExpenses:        { type: Boolean, default: true },
    syncCancellations:   { type: Boolean, default: true },
  },
  { timestamps: true },
);

TallyConfigSchema.index({ hotelId: 1 }, { unique: true });

export const TallyConfig = mongoose.model<ITallyConfig>('TallyConfig', TallyConfigSchema);
