import mongoose, { Schema, Document } from 'mongoose';

export type MessagingProviderType = 'msg91';
export type MessagingChannel      = 'whatsapp' | 'sms' | 'both';

export interface IMessagingProviderConfig extends Document {
  hotelId:          mongoose.Types.ObjectId;
  providerType:     MessagingProviderType;
  channel:          MessagingChannel;
  /** AES-256-GCM encrypted MSG91 authkey */
  apiKeyEnc:        string;
  /** WABA-connected phone number with country code — not secret */
  integratedNumber: string;
  /** DLT-registered SMS sender ID — not secret */
  senderId:         string;
  /** WhatsApp template namespace (may be blank for Cloud API accounts) */
  waNamespace:      string;
  /** Encrypted pre-shared header value for webhook auth — MSG91 has no HMAC */
  webhookSecretEnc: string;
  isActive:         boolean;
  isDeleted:        boolean;
  testResult?: {
    lastTestedAt: Date;
    success:      boolean;
    message:      string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MessagingProviderConfigSchema = new Schema<IMessagingProviderConfig>(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    providerType:     { type: String, enum: ['msg91'], required: true },
    channel:          { type: String, enum: ['whatsapp', 'sms', 'both'], required: true },
    apiKeyEnc:        { type: String, default: '' },
    integratedNumber: { type: String, default: '', maxlength: 20 },
    senderId:         { type: String, default: '', maxlength: 20 },
    waNamespace:      { type: String, default: '', maxlength: 200 },
    webhookSecretEnc: { type: String, default: '' },
    isActive:         { type: Boolean, default: true },
    isDeleted:        { type: Boolean, default: false },
    testResult: {
      lastTestedAt: { type: Date },
      success:      { type: Boolean },
      message:      { type: String, maxlength: 500 },
    },
  },
  { timestamps: true },
);

// One active config per hotel per provider — prevents duplicate credential sets
MessagingProviderConfigSchema.index(
  { hotelId: 1, providerType: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

export default mongoose.model<IMessagingProviderConfig>(
  'MessagingProviderConfig',
  MessagingProviderConfigSchema,
);
