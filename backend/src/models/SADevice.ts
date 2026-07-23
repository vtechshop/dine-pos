import { Schema, model, Document } from 'mongoose';

export interface ISADevice extends Document {
  pushToken: string;
  platform: 'ios' | 'android';
  createdAt: Date;
  updatedAt: Date;
}

const SADeviceSchema = new Schema<ISADevice>(
  {
    pushToken: { type: String, required: true, unique: true, trim: true },
    platform:  { type: String, enum: ['ios', 'android'], default: 'android' },
  },
  { timestamps: true },
);

export default model<ISADevice>('SADevice', SADeviceSchema);
