import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
  deviceId: string;
  hotelId: mongoose.Types.ObjectId;
  deviceName: string;
  platform: 'android' | 'ios' | 'web';
  appVersion: string;
  osVersion: string;
  lastSeen: Date;
  isOnline: boolean;
  pushToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema: Schema = new Schema(
  {
    deviceId:    { type: String, required: true },
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    deviceName:  { type: String, default: 'Unknown Device' },
    platform:    { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    appVersion:  { type: String, default: '' },
    osVersion:   { type: String, default: '' },
    lastSeen:    { type: Date, default: Date.now },
    isOnline:    { type: Boolean, default: false },
    pushToken:   { type: String, default: '' },
  },
  { timestamps: true }
);

// Unique device per hotel
DeviceSchema.index({ deviceId: 1, hotelId: 1 }, { unique: true });
DeviceSchema.index({ lastSeen: -1 });

export default mongoose.model<IDevice>('Device', DeviceSchema);
