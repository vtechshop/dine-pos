import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookLog extends Document {
  hotelId:         mongoose.Types.ObjectId | null;
  platform:        'swiggy' | 'zomato' | 'generic';
  event:           string;
  rawBody:         string;
  headers:         Record<string, string>;
  status:          'success' | 'failed' | 'retrying';
  errorMessage:    string | null;
  orderId:         mongoose.Types.ObjectId | null;
  platformOrderId: string;
  retryCount:      number;
  nextRetryAt:     Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IWebhookLog>(
  {
    hotelId:         { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    platform:        { type: String, enum: ['swiggy', 'zomato', 'generic'], required: true },
    event:           { type: String, default: 'new_order' },
    rawBody:         { type: String, maxlength: 20000, default: '' },
    headers:         { type: Schema.Types.Mixed, default: {} },
    status:          { type: String, enum: ['success', 'failed', 'retrying'], default: 'success' },
    errorMessage:    { type: String, default: null },
    orderId:         { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    platformOrderId: { type: String, default: '' },
    retryCount:      { type: Number, default: 0 },
    nextRetryAt:     { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ hotelId: 1, createdAt: -1 });
schema.index({ platform: 1, status: 1 });
schema.index({ status: 1, nextRetryAt: 1 }, { sparse: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 2_592_000 }); // 30-day TTL

export default mongoose.model<IWebhookLog>('WebhookLog', schema);
