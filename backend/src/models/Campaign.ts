import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel  = 'whatsapp' | 'sms';
export type CampaignStatus   = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';
export type CampaignAudience =
  | 'all' | 'new' | 'repeat' | 'vip'
  | 'inactive30' | 'inactive60' | 'inactive90'
  | 'birthday' | 'anniversary' | 'birthdayweek' | 'anniversaryweek'
  | 'loyalty' | 'noloyalty' | 'custom';

export interface ICampaign extends Document {
  hotelId:             mongoose.Types.ObjectId;
  name:                string;
  channel:             CampaignChannel;
  audience:            CampaignAudience;
  customAudience:      mongoose.Types.ObjectId[];  // customerProfile _ids (only when audience=custom)
  messageTemplate:     string;
  status:              CampaignStatus;
  scheduledAt:         Date | null;
  sentAt:              Date | null;
  recipientCount:      number;   // total audience size (including opted-out) at creation time
  eligibleCount:       number;   // opted-in audience size at creation time (will actually receive)
  sentCount:           number;   // actual sent count after dispatch
  failedCount:         number;   // actual failed count after dispatch
  failureReason:       string;
  createdBy:           string;
  /** WhatsApp approved template name (required when channel=whatsapp) */
  waTemplateName:      string | null;
  /** BCP-47 language code for the WA template, e.g. "en" */
  waTemplateLanguage:  string;
  /** WABA template namespace — may be empty for Cloud API WABA accounts */
  waTemplateNamespace: string;
  /** Ordered variable names mapping to body_1, body_2, ... positions */
  waTemplateVars:      string[];
  createdAt:           Date;
  updatedAt:           Date;
}

const CampaignSchema: Schema = new Schema(
  {
    hotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name:     { type: String, required: true, maxlength: 200, trim: true },
    channel:  { type: String, enum: ['whatsapp', 'sms'], required: true },
    audience: {
      type: String,
      enum: ['all', 'new', 'repeat', 'vip', 'inactive30', 'inactive60', 'inactive90',
             'birthday', 'anniversary', 'birthdayweek', 'anniversaryweek',
             'loyalty', 'noloyalty', 'custom'],
      required: true,
    },
    customAudience:  [{ type: Schema.Types.ObjectId, ref: 'CustomerProfile' }],
    messageTemplate: { type: String, required: true, maxlength: 4000 },
    status:              { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'], default: 'draft' },
    scheduledAt:         { type: Date, default: null },
    sentAt:              { type: Date, default: null },
    recipientCount:      { type: Number, default: 0, min: 0 },
    eligibleCount:       { type: Number, default: 0, min: 0 },
    sentCount:           { type: Number, default: 0, min: 0 },
    failedCount:         { type: Number, default: 0, min: 0 },
    failureReason:       { type: String, default: '', maxlength: 1000 },
    createdBy:           { type: String, default: 'admin', maxlength: 100 },
    waTemplateName:      { type: String, default: null },
    waTemplateLanguage:  { type: String, default: 'en', maxlength: 20 },
    waTemplateNamespace: { type: String, default: '', maxlength: 200 },
    waTemplateVars:      [{ type: String, maxlength: 50 }],
  },
  { timestamps: true }
);

CampaignSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
CampaignSchema.index({ hotelId: 1, scheduledAt: 1 }, { sparse: true });

export default mongoose.model<ICampaign>('Campaign', CampaignSchema);
