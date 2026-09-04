import mongoose, { Schema, Document } from 'mongoose';

export type AggregatorPlatform = 'swiggy' | 'zomato';

export interface IAggregatorIntegration extends Document {
  hotelId:          mongoose.Types.ObjectId;
  platform:         AggregatorPlatform;
  enabled:          boolean;
  storeId:          string;
  /** AES-256-GCM encrypted — never returned to frontend */
  apiKeyEnc:        string;
  /** AES-256-GCM encrypted — never returned to frontend */
  apiSecretEnc:     string;
  /** AES-256-GCM encrypted — never returned to frontend */
  webhookSecretEnc: string;
  menuSyncStatus:          'idle' | 'syncing' | 'success' | 'partial' | 'failed';
  /** E-F07: timestamp when the last 'syncing' status was set — used for stale-sync detection */
  syncingStartedAt:        Date | null;
  lastSyncAt:              Date | null;
  lastSyncError:           string | null;
  syncedItemCount:         number;
  failedItemCount:         number;
  lastOrderAt:             Date | null;
  connectionStatus:        'connected' | 'disconnected' | 'error';
  autoAccept:              boolean;
  lastTestAt:              Date | null;
  lastTestSuccess:         boolean | null;
  lastTestMessage:         string;
  autoSyncEnabled:         boolean;
  autoSyncIntervalMinutes: number;
  nextAutoSyncAt:          Date | null;
  lastAutoSyncAt:          Date | null;
  createdAt:               Date;
  updatedAt:               Date;
}

const schema = new Schema<IAggregatorIntegration>(
  {
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    platform:         { type: String, enum: ['swiggy', 'zomato'], required: true },
    enabled:          { type: Boolean, default: false },
    storeId:          { type: String, default: '' },
    apiKeyEnc:        { type: String, default: '' },
    apiSecretEnc:     { type: String, default: '' },
    webhookSecretEnc: { type: String, default: '' },
    menuSyncStatus:          { type: String, enum: ['idle', 'syncing', 'success', 'partial', 'failed'], default: 'idle' },
    syncingStartedAt:        { type: Date, default: null },
    lastSyncAt:              { type: Date,   default: null },
    lastSyncError:           { type: String, default: null },
    syncedItemCount:         { type: Number, default: 0 },
    failedItemCount:         { type: Number, default: 0 },
    lastOrderAt:             { type: Date,   default: null },
    connectionStatus:        { type: String, enum: ['connected', 'disconnected', 'error'], default: 'disconnected' },
    autoAccept:              { type: Boolean, default: false },
    lastTestAt:              { type: Date,   default: null },
    lastTestSuccess:         { type: Boolean, default: null },
    lastTestMessage:         { type: String, default: '' },
    autoSyncEnabled:         { type: Boolean, default: false },
    autoSyncIntervalMinutes: { type: Number,  default: 60 },
    nextAutoSyncAt:          { type: Date,   default: null },
    lastAutoSyncAt:          { type: Date,   default: null },
  },
  { timestamps: true },
);

schema.index({ hotelId: 1, platform: 1 }, { unique: true });
// Prevent two hotels from being mapped to the same platform storeId, which
// would cause incoming webhooks to be mis-routed. partialFilterExpression
// excludes integrations that have not yet had a storeId configured (default '').
schema.index(
  { platform: 1, storeId: 1 },
  { unique: true, partialFilterExpression: { storeId: { $type: 'string', $gt: '' } } },
);

export default mongoose.model<IAggregatorIntegration>('AggregatorIntegration', schema);
