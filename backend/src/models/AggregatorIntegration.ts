import mongoose, { Schema, Document } from 'mongoose';

export type AggregatorPlatform = 'swiggy' | 'zomato';

export interface IAggregatorIntegration extends Document {
  hotelId:          mongoose.Types.ObjectId;
  platform:         AggregatorPlatform;
  enabled:          boolean;
  storeId:          string;
  apiKey:           string;
  apiSecret:        string;
  webhookSecret:    string;
  menuSyncStatus:   'idle' | 'syncing' | 'success' | 'failed';
  lastSyncAt:       Date | null;
  lastSyncError:    string | null;
  syncedItemCount:  number;
  failedItemCount:  number;
  lastOrderAt:      Date | null;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  autoAccept:       boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IAggregatorIntegration>(
  {
    hotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    platform: { type: String, enum: ['swiggy', 'zomato'], required: true },
    enabled:  { type: Boolean, default: false },
    storeId:  { type: String, default: '' },
    apiKey:   { type: String, default: '' },
    apiSecret: { type: String, default: '' },
    webhookSecret: { type: String, default: '' },
    menuSyncStatus:  { type: String, enum: ['idle', 'syncing', 'success', 'failed'], default: 'idle' },
    lastSyncAt:      { type: Date, default: null },
    lastSyncError:   { type: String, default: null },
    syncedItemCount: { type: Number, default: 0 },
    failedItemCount: { type: Number, default: 0 },
    lastOrderAt:     { type: Date, default: null },
    connectionStatus:{ type: String, enum: ['connected', 'disconnected', 'error'], default: 'disconnected' },
    autoAccept:      { type: Boolean, default: false },
  },
  { timestamps: true },
);

schema.index({ hotelId: 1, platform: 1 }, { unique: true });
schema.index({ platform: 1, storeId: 1 });

export default mongoose.model<IAggregatorIntegration>('AggregatorIntegration', schema);
