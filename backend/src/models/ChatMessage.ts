import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage extends Document {
  tableNumber: string;
  sender: 'customer' | 'admin';
  message: string;
  read: boolean;
  createdAt: Date;
}

const ChatMessageSchema: Schema = new Schema(
  {
    tableNumber: { type: String, required: true },
    sender: { type: String, enum: ['customer', 'admin'], required: true },
    message: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ tableNumber: 1, createdAt: 1 });

export default mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
