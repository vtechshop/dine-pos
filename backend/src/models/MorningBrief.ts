import mongoose, { Schema, Document } from 'mongoose';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const BusinessSummarySchema = new Schema(
  {
    revenue:                  { type: Number, required: true },
    orders:                   { type: Number, required: true },
    estimatedProfit:          { type: Number, required: true },
    estimatedProfitMarginPct: { type: Number, required: true },
    avgBill:                  { type: Number, required: true },
    healthScore:              { type: Number, required: true },
    healthGrade:              { type: String, required: true },
    topSellingItem:           { type: String, default: null },
    topSellingItemRevenue:    { type: Number, default: 0 },
    topSellingItemQty:        { type: Number, default: 0 },
    peakHour:                 { type: Number, default: 0 },
    topPaymentMethod:         { type: String, default: 'cash' },
    revenueVs7DayAvgPct:     { type: Number, default: null },
    ordersVs7DayAvgPct:      { type: Number, default: null },
    cancelledOrders:          { type: Number, default: 0 },
    cancelRate:               { type: Number, default: 0 },
  },
  { _id: false },
);

const MenuSummarySchema = new Schema(
  {
    topMenuItems: [
      {
        name:    { type: String },
        revenue: { type: Number },
        qty:     { type: Number },
        _id:     false,
      },
    ],
    slowMovers: [{ type: String }],
  },
  { _id: false },
);

const InventorySummarySchema = new Schema(
  {
    criticalItems:       [{ type: String }],
    warningItems:        [{ type: String }],
    overstockItems:      [{ type: String }],
    totalReorderCost:    { type: Number, default: 0 },
    criticalCount:       { type: Number, default: 0 },
    warningCount:        { type: Number, default: 0 },
    reorderRequiredNames: [{ type: String }],
  },
  { _id: false },
);

const ForecastSummarySchema = new Schema(
  {
    expectedRevenue:    { type: Number, required: true },
    expectedOrders:     { type: Number, required: true },
    expectedAov:        { type: Number, required: true },
    topBusyHours:       [{ type: Number }],
    forecastConfidence: { type: Number, default: 0 },
    method:             { type: String, default: 'unavailable' },
  },
  { _id: false },
);

const NotificationStatusSchema = new Schema(
  {
    emailQueued:    { type: Boolean, default: false },
    whatsappQueued: { type: Boolean, default: false },
    pushQueued:     { type: Boolean, default: false },
    sentAt:         { type: Date, default: null },
  },
  { _id: false },
);

// ─── Main document interface ──────────────────────────────────────────────────

export interface IMorningBrief extends Document {
  hotelId:       mongoose.Types.ObjectId;
  date:          string;          // YYYY-MM-DD — the date summarized (yesterday)
  generatedAt:   Date;
  dataInputHash: string;          // SHA-256 of DailySnapshot hash — idempotency guard

  business:     Record<string, unknown>;
  menu:         Record<string, unknown>;
  inventory:    Record<string, unknown>;
  forecast:     Record<string, unknown>;

  executiveSummary:  string;
  recommendations:   string[];    // 3 items from Gemini
  opportunity:       string;
  warning:           string | null;

  notifications: Record<string, unknown>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MorningBriefSchema = new Schema<IMorningBrief>(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    date:          { type: String, required: true },
    generatedAt:   { type: Date, default: Date.now },
    dataInputHash: { type: String, required: true },

    business:  { type: BusinessSummarySchema,  required: true },
    menu:      { type: MenuSummarySchema,      default: () => ({ topMenuItems: [], slowMovers: [] }) },
    inventory: { type: InventorySummarySchema, default: () => ({}) },
    forecast:  { type: ForecastSummarySchema,  required: true },

    executiveSummary: { type: String, default: '' },
    recommendations:  { type: [String], default: [] },
    opportunity:      { type: String,  default: '' },
    warning:          { type: String,  default: null },

    notifications: { type: NotificationStatusSchema, default: () => ({}) },
  },
  { timestamps: false },
);

// One brief per hotel per date — unique + fast lookup
MorningBriefSchema.index({ hotelId: 1, date: -1 }, { unique: true });
// Latest brief: sort by date desc
MorningBriefSchema.index({ hotelId: 1, generatedAt: -1 });

export default mongoose.model<IMorningBrief>('MorningBrief', MorningBriefSchema);
