import mongoose, { Schema, Document } from 'mongoose';

export type MenuSyncHistoryStatus = 'running' | 'success' | 'partial' | 'failed';
export type MenuSyncType          = 'full' | 'availability' | 'item' | 'scheduled';
export type SyncTriggeredBy       = 'manual' | 'scheduled' | 'system';

export interface IMenuSyncHistory extends Document {
  hotelId:           mongoose.Types.ObjectId;
  platform:          'swiggy' | 'zomato';
  syncType:          MenuSyncType;
  triggeredBy:       SyncTriggeredBy;
  triggeredByUserId: mongoose.Types.ObjectId | null;
  status:            MenuSyncHistoryStatus;
  startedAt:         Date;
  completedAt:       Date | null;
  durationMs:        number | null;
  totalItems:        number;
  syncedItems:       number;
  failedItems:       number;
  errorCount:        number;
  externalSynced:    boolean;
  failureSummary:    { itemName: string; error: string }[];
  createdAt:         Date;
  updatedAt:         Date;
}

const schema = new Schema<IMenuSyncHistory>(
  {
    hotelId:           { type: Schema.Types.ObjectId, ref: 'Hotel',  required: true },
    platform:          { type: String, enum: ['swiggy', 'zomato'],   required: true },
    syncType:          { type: String, enum: ['full', 'availability', 'item', 'scheduled'], default: 'full' },
    triggeredBy:       { type: String, enum: ['manual', 'scheduled', 'system'],             default: 'manual' },
    triggeredByUserId: { type: Schema.Types.ObjectId, ref: 'User',   default: null },
    status:            { type: String, enum: ['running', 'success', 'partial', 'failed'],   default: 'running' },
    startedAt:         { type: Date,   required: true },
    completedAt:       { type: Date,   default: null },
    durationMs:        { type: Number, default: null },
    totalItems:        { type: Number, default: 0 },
    syncedItems:       { type: Number, default: 0 },
    failedItems:       { type: Number, default: 0 },
    errorCount:        { type: Number, default: 0 },
    externalSynced:    { type: Boolean, default: false },
    failureSummary:    [{ itemName: { type: String }, error: { type: String } }],
  },
  { timestamps: true },
);

schema.index({ hotelId: 1, createdAt: -1 });
schema.index({ hotelId: 1, platform: 1, createdAt: -1 });

export default mongoose.model<IMenuSyncHistory>('MenuSyncHistory', schema);
