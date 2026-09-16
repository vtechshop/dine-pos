import mongoose, { Schema, Document } from 'mongoose';

export type TallySyncEntityType = 'order' | 'cancellation' | 'purchase_invoice' | 'expense';
export type TallySyncOperation  = 'create' | 'cancel';
export type TallySyncStatus     = 'pending' | 'syncing' | 'synced' | 'failed' | 'skipped';

export interface ITallySyncJob extends Document {
  hotelId:           mongoose.Types.ObjectId;
  entityType:        TallySyncEntityType;
  entityId:          mongoose.Types.ObjectId;
  operation:         TallySyncOperation;
  payloadVersion:    number;
  status:            TallySyncStatus;
  idempotencyKey:    string;       // hotelId:entityType:entityId:operation
  attemptCount:      number;
  lastAttemptAt:     Date | null;
  nextAttemptAt:     Date | null;
  syncedAt:          Date | null;
  externalReference: string;       // Tally response reference
  voucherNumber:     string;       // human-readable from ack
  errorCode:         string;
  errorReason:       string;
  createdAt:         Date;
  updatedAt:         Date;
}

const TallySyncJobSchema: Schema = new Schema(
  {
    hotelId:           { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    entityType:        { type: String, enum: ['order', 'cancellation', 'purchase_invoice', 'expense'], required: true },
    entityId:          { type: Schema.Types.ObjectId, required: true },
    operation:         { type: String, enum: ['create', 'cancel'], required: true },
    payloadVersion:    { type: Number, default: 1 },
    status:            { type: String, enum: ['pending', 'syncing', 'synced', 'failed', 'skipped'], default: 'pending' },
    idempotencyKey:    { type: String, required: true },
    attemptCount:      { type: Number, default: 0 },
    lastAttemptAt:     { type: Date, default: null },
    nextAttemptAt:     { type: Date, default: null },
    syncedAt:          { type: Date, default: null },
    externalReference: { type: String, default: '' },
    voucherNumber:     { type: String, default: '' },
    errorCode:         { type: String, default: '' },
    errorReason:       { type: String, default: '' },
  },
  { timestamps: true },
);

TallySyncJobSchema.index({ hotelId: 1, status: 1 });
TallySyncJobSchema.index({ idempotencyKey: 1 }, { unique: true });
TallySyncJobSchema.index({ hotelId: 1, entityId: 1, entityType: 1 });
TallySyncJobSchema.index({ status: 1, nextAttemptAt: 1 });
TallySyncJobSchema.index({ hotelId: 1, createdAt: -1 });

export const TallySyncJob = mongoose.model<ITallySyncJob>('TallySyncJob', TallySyncJobSchema);
