import mongoose, { Schema, Document } from 'mongoose';

export type WaitlistStatus = 'waiting' | 'notified' | 'seated' | 'cancelled' | 'expired';

export interface IWaitlist extends Document {
  hotelId:              mongoose.Types.ObjectId;
  guestName:            string;
  phone:                string;
  partySize:            number;
  seatingPreference:    string;
  priority:             number;
  estimatedWaitMinutes: number;
  status:               WaitlistStatus;
  notifiedAt:           Date | null;
  notes:                string;
  createdAt:            Date;
  updatedAt:            Date;
}

const WaitlistSchema: Schema = new Schema(
  {
    hotelId:              { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    guestName:            { type: String, required: true, trim: true, maxlength: 120 },
    phone:                { type: String, required: true, trim: true, maxlength: 20 },
    partySize:            { type: Number, required: true, min: 1, max: 200 },
    seatingPreference:    { type: String, default: '' },
    priority:             { type: Number, default: 0 },
    estimatedWaitMinutes: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['waiting', 'notified', 'seated', 'cancelled', 'expired'],
      default: 'waiting',
    },
    notifiedAt: { type: Date, default: null },
    notes:      { type: String, default: '' },
  },
  { timestamps: true },
);

WaitlistSchema.index({ hotelId: 1, status: 1, createdAt: 1 });

export default mongoose.model<IWaitlist>('Waitlist', WaitlistSchema);
