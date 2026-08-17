// ─── Persistent Alert Model ───────────────────────────────────────────────────
// Smart alerts are computed hourly and persisted here.
// Deduplication: one active alert per (hotelId, type, dedupDate).
// An alert is "resolved" when the same type does NOT fire in the next computation.

import mongoose, { Document, Schema } from 'mongoose';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertType =
  | 'sales_drop'
  | 'revenue_spike'
  | 'avg_bill_decrease'
  | 'table_utilization_drop'
  | 'kitchen_delay'
  | 'low_inventory'
  | 'excessive_cancellations'
  | 'discount_anomaly'
  | 'payment_anomaly'
  | 'cashier_anomaly'
  | 'duplicate_transaction'
  | 'off_hours_activity'
  | 'refund_anomaly';

export interface IAlert extends Document {
  hotelId:        mongoose.Types.ObjectId;
  type:           AlertType;
  severity:       AlertSeverity;
  title:          string;
  message:        string;
  value:          number;
  baseline:       number;
  changePct:      number | null;
  dedupDate:      string;   // "YYYY-MM-DD" — one active alert per type per day
  isRead:         boolean;
  readAt:         Date | null;
  resolvedAt:     Date | null;  // null = still active
  createdAt:      Date;
  updatedAt:      Date;
}

const AlertSchema = new Schema<IAlert>(
  {
    hotelId:    { type: Schema.Types.ObjectId, ref: 'Hotel',  required: true },
    type:       { type: String, required: true },
    severity:   { type: String, enum: ['critical', 'warning', 'info'], required: true },
    title:      { type: String, required: true, trim: true },
    message:    { type: String, required: true, trim: true },
    value:      { type: Number, default: 0 },
    baseline:   { type: Number, default: 0 },
    changePct:  { type: Number, default: null },
    dedupDate:  { type: String, required: true },
    isRead:     { type: Boolean, default: false },
    readAt:     { type: Date,    default: null },
    resolvedAt: { type: Date,    default: null },
  },
  { timestamps: true },
);

// Unique: one active alert per type per hotel per day
AlertSchema.index({ hotelId: 1, type: 1, dedupDate: 1 }, { unique: true });
AlertSchema.index({ hotelId: 1, isRead: 1, resolvedAt: 1 });
AlertSchema.index({ hotelId: 1, dedupDate: 1 });

export default mongoose.model<IAlert>('Alert', AlertSchema);
