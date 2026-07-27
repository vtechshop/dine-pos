import mongoose, { Schema, Document } from 'mongoose';
import { IItemMetric, IPaymentBreakdown, ISourceBreakdown, ItemMetricSchema, PaymentBreakdownSchema, SourceBreakdownSchema } from './HourlyMetrics';

export interface IDailySnapshot extends Document {
  hotelId:                   mongoose.Types.ObjectId;
  date:                      string;   // "YYYY-MM-DD" UTC

  // Core metrics
  totalRevenue:              number;
  totalOrders:               number;
  avgOrderValue:             number;
  cancelledOrders:           number;
  cancelledRevenue:          number;

  // Breakdowns
  paymentBreakdown:          IPaymentBreakdown;
  sourceBreakdown:           ISourceBreakdown;

  // Item data
  topItems:                  IItemMetric[];  // top 10 by qty (for leaderboard display)
  allItems:                  IItemMetric[];  // top 100 by revenue (for menu engineering in Phase 4)

  // Peak-hour analytics
  peakHour:                  number;   // 0–23
  peakHourRevenue:           number;
  hourlyRevenue:             number[]; // [0..23]
  hourlyOrders:              number[]; // [0..23]

  uniqueTables:              number;

  // Delta vs historical baselines (null = insufficient history)
  revenueVs7DayAvgPct:       number | null;
  ordersVs7DayAvgPct:        number | null;
  revenueVsSameWeekdayPct:   number | null;

  // Idempotency: hash of key inputs for deduplication / change detection
  dataInputHash:             string;
  computedAt:                Date;
}

const DailySnapshotSchema = new Schema<IDailySnapshot>(
  {
    hotelId:                 { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    date:                    { type: String, required: true },
    totalRevenue:            { type: Number, default: 0 },
    totalOrders:             { type: Number, default: 0 },
    avgOrderValue:           { type: Number, default: 0 },
    cancelledOrders:         { type: Number, default: 0 },
    cancelledRevenue:        { type: Number, default: 0 },
    paymentBreakdown:        { type: PaymentBreakdownSchema, default: () => ({}) },
    sourceBreakdown:         { type: SourceBreakdownSchema,  default: () => ({}) },
    topItems:                { type: [ItemMetricSchema], default: [] },
    allItems:                { type: [ItemMetricSchema], default: [] },
    peakHour:                { type: Number, default: 0 },
    peakHourRevenue:         { type: Number, default: 0 },
    hourlyRevenue:           { type: [Number], default: () => Array(24).fill(0) },
    hourlyOrders:            { type: [Number], default: () => Array(24).fill(0) },
    uniqueTables:            { type: Number, default: 0 },
    revenueVs7DayAvgPct:    { type: Number, default: null },
    ordersVs7DayAvgPct:     { type: Number, default: null },
    revenueVsSameWeekdayPct:{ type: Number, default: null },
    dataInputHash:           { type: String, required: true },
    computedAt:              { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Primary access pattern: hotel's snapshot for a specific date
DailySnapshotSchema.index({ hotelId: 1, date: -1 }, { unique: true });

export default mongoose.model<IDailySnapshot>('DailySnapshot', DailySnapshotSchema);
