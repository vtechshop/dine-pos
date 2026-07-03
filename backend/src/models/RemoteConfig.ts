import mongoose, { Schema, Document } from 'mongoose';

export interface IRemoteConfig extends Document {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  minimumAppVersion: string;
  minimumAppVersionIos: string;
  forceUpdate: boolean;
  forceUpdateMessage: string;
  trialDays: number;
  paymentEnabled: boolean;
  broadcastMessage: string;
  broadcastMessageType: 'info' | 'warning' | 'success';
  updatedAt: Date;
}

const RemoteConfigSchema: Schema = new Schema(
  {
    maintenanceMode:        { type: Boolean, default: false },
    maintenanceMessage:     { type: String, default: 'We are currently under maintenance. Please try again later.' },
    minimumAppVersion:      { type: String, default: '1.0.0' },
    minimumAppVersionIos:   { type: String, default: '1.0.0' },
    forceUpdate:            { type: Boolean, default: false },
    forceUpdateMessage:     { type: String, default: 'A new version of the app is available. Please update to continue.' },
    trialDays:              { type: Number, default: 14 },
    paymentEnabled:         { type: Boolean, default: false },
    broadcastMessage:       { type: String, default: '' },
    broadcastMessageType:   { type: String, enum: ['info', 'warning', 'success'], default: 'info' },
  },
  { timestamps: true }
);

export default mongoose.model<IRemoteConfig>('RemoteConfig', RemoteConfigSchema);
