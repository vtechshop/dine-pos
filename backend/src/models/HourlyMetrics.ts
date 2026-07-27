import mongoose, { Schema, Document } from 'mongoose';

export interface IItemMetric {
  productId:   mongoose.Types.ObjectId;
  productName: string;
  qty:         number;
  revenue:     number;
}

export interface IPaymentBreakdown {
  cash:  number;
  upi:   number;
  card:  number;
  split: number;
}

export interface ISourceBreakdown {
  dineIn:   number;
  takeaway: number;
  qr:       number;
  swiggy:   number;
  zomato:   number;
  other:    number;
}

export interface IHourlyMetrics extends Document {
  hotelId:          mongoose.Types.ObjectId;
  date:             string;   // "YYYY-MM-DD" UTC
  hour:             number;   // 0–23 UTC
  orderCount:       number;
  revenue:          number;
  avgOrderValue:    number;
  cancelledCount:   number;
  cancelledRevenue: number;
  paymentBreakdown: IPaymentBreakdown;
  sourceBreakdown:  ISourceBreakdown;
  topItems:         IItemMetric[];  // top 10 by revenue this hour (real-time leaderboard feed)
  uniqueTables:     number;
  computedAt:       Date;
}

export const ItemMetricSchema = new Schema<IItemMetric>(
  {
    productId:   { type: Schema.Types.ObjectId },
    productName: { type: String, required: true },
    qty:         { type: Number, required: true },
    revenue:     { type: Number, required: true },
  },
  { _id: false },
);

export const PaymentBreakdownSchema = new Schema<IPaymentBreakdown>(
  {
    cash:  { type: Number, default: 0 },
    upi:   { type: Number, default: 0 },
    card:  { type: Number, default: 0 },
    split: { type: Number, default: 0 },
  },
  { _id: false },
);

export const SourceBreakdownSchema = new Schema<ISourceBreakdown>(
  {
    dineIn:   { type: Number, default: 0 },
    takeaway: { type: Number, default: 0 },
    qr:       { type: Number, default: 0 },
    swiggy:   { type: Number, default: 0 },
    zomato:   { type: Number, default: 0 },
    other:    { type: Number, default: 0 },
  },
  { _id: false },
);

const HourlyMetricsSchema = new Schema<IHourlyMetrics>(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    date:             { type: String, required: true },
    hour:             { type: Number, required: true, min: 0, max: 23 },
    orderCount:       { type: Number, default: 0 },
    revenue:          { type: Number, default: 0 },
    avgOrderValue:    { type: Number, default: 0 },
    cancelledCount:   { type: Number, default: 0 },
    cancelledRevenue: { type: Number, default: 0 },
    paymentBreakdown: { type: PaymentBreakdownSchema, default: () => ({}) },
    sourceBreakdown:  { type: SourceBreakdownSchema,  default: () => ({}) },
    topItems:         { type: [ItemMetricSchema], default: [] },
    uniqueTables:     { type: Number, default: 0 },
    computedAt:       { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Unique per hotel + date + hour — the natural primary key for upserts
HourlyMetricsSchema.index({ hotelId: 1, date: 1, hour: 1 }, { unique: true });
// Daily rollup query: all hours for a hotel on a given date
HourlyMetricsSchema.index({ hotelId: 1, date: 1 });

export default mongoose.model<IHourlyMetrics>('HourlyMetrics', HourlyMetricsSchema);
