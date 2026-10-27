import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketReply {
  message: string;
  by: 'hotel' | 'superadmin';
  createdAt: Date;
}

export interface ITicket extends Document {
  /** Owning hotel (from the JWT). Older tickets predate this field and are
   *  matched by the hotel's stored phone instead. */
  hotelId?: mongoose.Types.ObjectId | null;
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
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', default: null, index: true },
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
