import mongoose, { Schema, Document } from 'mongoose';

export interface IReservation extends Document {
  hotelId: mongoose.Types.ObjectId;
  tableId?: mongoose.Types.ObjectId;
  tableNumber?: number;
  customerName: string;
  phone: string;
  partySize: number;
  date: Date;
  time: string;
  status: 'confirmed' | 'seated' | 'cancelled' | 'no-show';
  notes: string;
  createdAt: Date;
}

const ReservationSchema: Schema = new Schema(
  {
    hotelId:      { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    tableId:      { type: Schema.Types.ObjectId, ref: 'Table', default: null },
    tableNumber:  { type: Number, default: null },
    customerName: { type: String, required: true, trim: true },
    phone:        { type: String, required: true, trim: true },
    partySize:    { type: Number, required: true, min: 1 },
    date:         { type: Date, required: true },
    time:         { type: String, required: true },
    status:       { type: String, enum: ['confirmed', 'seated', 'cancelled', 'no-show'], default: 'confirmed' },
    notes:        { type: String, default: '' },
  },
  { timestamps: true }
);

ReservationSchema.index({ hotelId: 1, date: -1 });

export default mongoose.model<IReservation>('Reservation', ReservationSchema);
