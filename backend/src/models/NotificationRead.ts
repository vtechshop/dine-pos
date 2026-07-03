import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationRead extends Document {
  notificationId: mongoose.Types.ObjectId;
  hotelId: mongoose.Types.ObjectId;
  readAt: Date;
}

const NotificationReadSchema = new Schema<INotificationRead>({
  notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', required: true },
  hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
  readAt:         { type: Date, default: Date.now },
});

// Unique constraint: one read record per (notification, hotel)
NotificationReadSchema.index({ notificationId: 1, hotelId: 1 }, { unique: true });
// Fast lookup: which notifications has this hotel read?
NotificationReadSchema.index({ hotelId: 1, notificationId: 1 });

export default mongoose.model<INotificationRead>('NotificationRead', NotificationReadSchema);
