/**
 * WhatsAppReceipt — per-order (or per-guest-session) delivery tracking.
 *
 * Idempotency invariants:
 *  - One receipt record per (hotelId + orderId + purpose) — partial unique index.
 *  - One receipt record per (hotelId + guestId + purpose) — partial unique index.
 *  - $setOnInsert upsert in createWhatsAppReceiptJob prevents double-creation.
 *  - providerMessageId arrives from webhook AFTER send; not set at creation.
 *
 * Status flow (forward-only, matches CampaignMessage rank):
 *   queued → sending → sent → delivered → read
 *                   ↘ failed (terminal if maxAttempts reached)
 *   skipped  (no provider configured; not a failure)
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

export type WARStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped';

export type WARPurpose = 'receipt';

export interface IWhatsAppReceipt extends Document {
  hotelId:           Types.ObjectId;
  /** Set for takeaway / quick-service orders */
  orderId?:          Types.ObjectId;
  /** Set for dine-in guest session billing */
  guestId?:          Types.ObjectId;
  customerId?:       Types.ObjectId;
  /** Phone number as supplied by staff / customer record */
  phoneNumber:       string;
  /** E.164 normalised — used for MSG91 and webhook correlation */
  normalizedPhone:   string;
  provider:          'msg91';
  templateName:      string;
  templateLanguage:  string;
  /** Ordered variable names matching template body_1, body_2, … */
  templateVars:      string[];
  /** Batch-level MSG91 request ID set after successful send API call */
  requestId?:        string;
  /** Per-message WAMID — arrives via webhook, not at send time */
  providerMessageId?: string;
  status:            WARStatus;
  attemptCount:      number;
  maxAttempts:       number;
  lastAttemptAt?:    Date;
  nextRetryAt?:      Date;
  sentAt?:           Date;
  deliveredAt?:      Date;
  readAt?:           Date;
  failedAt?:         Date;
  /** Machine-readable code for UI decisions */
  failureCode?:      string;
  /** Cashier-safe reason — no DB/provider internals */
  failureReason?:    string;
  purpose:           WARPurpose;
  createdAt:         Date;
  updatedAt:         Date;
}

const WhatsAppReceiptSchema = new Schema<IWhatsAppReceipt>(
  {
    hotelId:           { type: Schema.Types.ObjectId, ref: 'Hotel',           required: true, index: true },
    orderId:           { type: Schema.Types.ObjectId, ref: 'Order',           default: null },
    guestId:           { type: Schema.Types.ObjectId, ref: 'Guest',           default: null },
    customerId:        { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
    phoneNumber:       { type: String, required: true, maxlength: 30 },
    normalizedPhone:   { type: String, required: true, maxlength: 20 },
    provider:          { type: String, enum: ['msg91'], required: true },
    templateName:      { type: String, required: true, maxlength: 200 },
    templateLanguage:  { type: String, required: true, maxlength: 10, default: 'en' },
    templateVars:      { type: [String], default: [] },
    requestId:         { type: String, default: null },
    providerMessageId: { type: String, default: null },
    status:            {
      type:    String,
      enum:    ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'],
      default: 'queued',
      index:   true,
    },
    attemptCount:  { type: Number, default: 0, min: 0 },
    maxAttempts:   { type: Number, default: 3, min: 1, max: 10 },
    lastAttemptAt: { type: Date, default: null },
    nextRetryAt:   { type: Date, default: null, index: true },
    sentAt:        { type: Date, default: null },
    deliveredAt:   { type: Date, default: null },
    readAt:        { type: Date, default: null },
    failedAt:      { type: Date, default: null },
    failureCode:   { type: String, default: null, maxlength: 100 },
    failureReason: { type: String, default: null, maxlength: 500 },
    purpose:       { type: String, enum: ['receipt'], required: true, default: 'receipt' },
  },
  { timestamps: true },
);

// ── Idempotency indexes (partial — only when the reference field is present) ──

// One receipt per order
WhatsAppReceiptSchema.index(
  { hotelId: 1, orderId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: { orderId: { $type: 'objectId' } },
    name: 'war_order_idempotency',
  },
);

// One receipt per dine-in guest session
WhatsAppReceiptSchema.index(
  { hotelId: 1, guestId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: { guestId: { $type: 'objectId' } },
    name: 'war_guest_idempotency',
  },
);

// Worker sweep: find queued records with nextRetryAt <= now
WhatsAppReceiptSchema.index({ status: 1, nextRetryAt: 1 });

// Admin receipt history: hotel-scoped by date
WhatsAppReceiptSchema.index({ hotelId: 1, createdAt: -1 });

// Webhook correlation: find by requestId + normalizedPhone + hotelId
WhatsAppReceiptSchema.index({ requestId: 1, normalizedPhone: 1, hotelId: 1 }, {
  partialFilterExpression: { requestId: { $type: 'string' } },
  sparse: true,
});

export default mongoose.model<IWhatsAppReceipt>('WhatsAppReceipt', WhatsAppReceiptSchema);
