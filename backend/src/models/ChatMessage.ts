import mongoose, { Schema, Document } from 'mongoose';

// MIGRATION REQUIRED before deploying this schema change:
//   db.chatmessages.updateMany(
//     { hotelId: { $type: 'string' } },
//     [{ $set: { hotelId: { $toObjectId: '$hotelId' } } }]
//   )
// Run this in the MongoDB shell against the production database BEFORE deploying.
// Existing documents have hotelId stored as BSON String; queries with ObjectId
// will return empty until the data is migrated.
export interface IChatMessage extends Document {
  hotelId: mongoose.Types.ObjectId;
  tableNumber: string;
  sender: 'customer' | 'admin';
  message: string;
  read: boolean;
  createdAt: Date;
}

const ChatMessageSchema: Schema = new Schema(
  {
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    tableNumber: { type: String, required: true },
    sender:      { type: String, enum: ['customer', 'admin'], required: true },
    message:     { type: String, required: true, trim: true },
    read:        { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ hotelId: 1, tableNumber: 1, createdAt: 1 });

export default mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
