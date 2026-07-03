import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'maintenance' | 'update' | 'success';
  targetHotels: mongoose.Types.ObjectId[];
  readBy: mongoose.Types.ObjectId[];
  createdBy: string;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema = new Schema(
  {
    title:         { type: String, required: true },
    message:       { type: String, required: true },
    type:          { type: String, enum: ['info', 'warning', 'maintenance', 'update', 'success'], default: 'info' },
    targetHotels:  [{ type: Schema.Types.ObjectId, ref: 'Hotel' }],
    readBy:        [{ type: Schema.Types.ObjectId, ref: 'Hotel' }],
    createdBy:     { type: String, default: 'superadmin' },
    expiresAt:     { type: Date, default: null },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ isActive: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
