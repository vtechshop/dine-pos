import mongoose, { Schema, Document } from 'mongoose';

export type CampaignMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ICampaignMessage extends Document {
  campaignId:        mongoose.Types.ObjectId;
  hotelId:           mongoose.Types.ObjectId;
  customerId:        mongoose.Types.ObjectId | null;
  phone:             string;
  channel:           'whatsapp' | 'sms';
  provider:          'msg91' | 'none';
  /** Batch-level request ID returned by MSG91 at send time */
  requestId:         string | null;
  /** Per-message WAMID — populated from webhook after delivery */
  providerMessageId: string | null;
  status:            CampaignMessageStatus;
  failureReason:     string;
  queuedAt:          Date;
  sentAt:            Date | null;
  deliveredAt:       Date | null;
  readAt:            Date | null;
  failedAt:          Date | null;
}

const CampaignMessageSchema = new Schema<ICampaignMessage>({
  campaignId:        { type: Schema.Types.ObjectId, ref: 'Campaign',        required: true },
  hotelId:           { type: Schema.Types.ObjectId, ref: 'Hotel',           required: true },
  customerId:        { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
  phone:             { type: String, required: true },
  channel:           { type: String, enum: ['whatsapp', 'sms'], required: true },
  provider:          { type: String, enum: ['msg91', 'none'], default: 'none' },
  requestId:         { type: String, default: null },
  providerMessageId: { type: String, default: null },
  status:            { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed'], default: 'queued' },
  failureReason:     { type: String, default: '' },
  queuedAt:          { type: Date, default: Date.now },
  sentAt:            { type: Date, default: null },
  deliveredAt:       { type: Date, default: null },
  readAt:            { type: Date, default: null },
  failedAt:          { type: Date, default: null },
});

// One record per recipient per campaign — prevents double-dispatch
CampaignMessageSchema.index({ campaignId: 1, phone: 1 }, { unique: true });
// Webhook lookup: requestId + phone → unique message in a batch
CampaignMessageSchema.index({ requestId: 1, phone: 1 }, { sparse: true });
// Hotel-scoped delivery report queries + status variant for aggregation
CampaignMessageSchema.index({ hotelId: 1, campaignId: 1 });
CampaignMessageSchema.index({ hotelId: 1, campaignId: 1, status: 1 });
// Auto-purge delivery records after 90 days
CampaignMessageSchema.index({ queuedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model<ICampaignMessage>('CampaignMessage', CampaignMessageSchema);
