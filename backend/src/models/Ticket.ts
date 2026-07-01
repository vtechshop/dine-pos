import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketReply {
  message: string;
  by: 'hotel' | 'superadmin';
  createdAt: Date;
}

export interface ITicket extends Document {
  hotelName: string;
  hotelPhone: string;
  subject: string;
  description: string;
  category: 'technical' | 'billing' | 'account' | 'other';
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  replies: ITicketReply[];
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema: Schema = new Schema(
  {
    hotelName:   { type: String, required: true },
    hotelPhone:  { type: String, required: true },
    subject:     { type: String, required: true },
    description: { type: String, required: true },
    category:    { type: String, enum: ['technical', 'billing', 'account', 'other'], default: 'other' },
    priority:    { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status:      { type: String, enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
    replies: [{
      message:   { type: String, required: true },
      by:        { type: String, enum: ['hotel', 'superadmin'], required: true },
      createdAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

TicketSchema.index({ hotelPhone: 1, createdAt: -1 }); // hotel ticket lookup
TicketSchema.index({ status: 1, createdAt: -1 });      // super admin ticket list

export default mongoose.model<ITicket>('Ticket', TicketSchema);
