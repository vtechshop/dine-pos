import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWaiter extends Document {
  hotelId: Types.ObjectId;
  name: string;
  employeeCode: string;
  pin: string;
  mobile: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WaiterSchema: Schema = new Schema(
  {
    hotelId:      { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name:         { type: String, required: true, trim: true },
    employeeCode: { type: String, required: true, trim: true },
    pin:          { type: String, required: true },
    mobile:       { type: String, default: '' },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Employee code must be unique within a hotel
WaiterSchema.index({ hotelId: 1, employeeCode: 1 }, { unique: true });

export default mongoose.model<IWaiter>('Waiter', WaiterSchema);
