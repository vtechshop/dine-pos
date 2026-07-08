import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IDevice extends Document {
  deviceId:          string;
  hotelId:           mongoose.Types.ObjectId;
  adminId?:          string;
  deviceName:        string;
  platform:          'android' | 'ios' | 'web';
  appVersion:        string;
  osVersion:         string;
  refreshTokenHash?: string;
  rememberDevice:    boolean;
  isActive:          boolean;
  lastSeen:          Date;
  isOnline:          boolean;
  pushToken:         string;
  createdAt:         Date;
  updatedAt:         Date;
}

const DeviceSchema: Schema = new Schema(
  {
    deviceId:         { type: String, required: true },
    hotelId:          { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    adminId:          { type: String, default: '' },
    deviceName:       { type: String, default: 'Unknown Device' },
    platform:         { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    appVersion:       { type: String, default: '' },
    osVersion:        { type: String, default: '' },
    refreshTokenHash: { type: String, default: '' },
    rememberDevice:   { type: Boolean, default: true },
    isActive:         { type: Boolean, default: true },
    lastSeen:         { type: Date, default: Date.now },
    isOnline:         { type: Boolean, default: false },
    pushToken:        { type: String, default: '' },
  },
  { timestamps: true }
);

// Unique device per hotel
DeviceSchema.index({ deviceId: 1, hotelId: 1 }, { unique: true });
DeviceSchema.index({ lastSeen: -1 });
DeviceSchema.index({ hotelId: 1, isActive: 1 });

export const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export default mongoose.model<IDevice>('Device', DeviceSchema);
