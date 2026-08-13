import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel  = 'whatsapp' | 'sms';
export type CampaignStatus   = 'draft' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
export type CampaignAudience =
  | 'all' | 'new' | 'repeat' | 'vip'
  | 'inactive30' | 'inactive60' | 'inactive90'
  | 'birthday' | 'anniversary'
  | 'loyalty' | 'noloyalty' | 'custom';

export interface ICampaign extends Document {
  hotelId:         mongoose.Types.ObjectId;
  name:            string;
  channel:         CampaignChannel;
  audience:        CampaignAudience;
  customAudience:  mongoose.Types.ObjectId[];  // customerProfile _ids (only when audience=custom)
  messageTemplate: string;
  status:          CampaignStatus;
  scheduledAt:     Date | null;
  sentAt:          Date | null;
  recipientCount:  number;
  failureReason:   string;
  createdBy:       string;
  createdAt:       Date;
  updatedAt:       Date;
}

const CampaignSchema: Schema = new Schema(
  {
    hotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name:     { type: String, required: true, maxlength: 200, trim: true },
    channel:  { type: String, enum: ['whatsapp', 'sms'], required: true },
    audience: {
      type: String,
      enum: ['all', 'new', 'repeat', 'vip', 'inactive30', 'inactive60', 'inactive90',
             'birthday', 'anniversary', 'loyalty', 'noloyalty', 'custom'],
      required: true,
    },
    customAudience:  [{ type: Schema.Types.ObjectId, ref: 'CustomerProfile' }],
    messageTemplate: { type: String, required: true, maxlength: 4000 },
    status:          { type: String, enum: ['draft', 'scheduled', 'sent', 'failed', 'cancelled'], default: 'draft' },
    scheduledAt:     { type: Date, default: null },
    sentAt:          { type: Date, default: null },
    recipientCount:  { type: Number, default: 0, min: 0 },
    failureReason:   { type: String, default: '', maxlength: 1000 },
    createdBy:       { type: String, default: 'admin', maxlength: 100 },
  },
  { timestamps: true }
);

CampaignSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
CampaignSchema.index({ hotelId: 1, scheduledAt: 1 }, { sparse: true });

export default mongoose.model<ICampaign>('Campaign', CampaignSchema);
