import mongoose, { Schema, Document } from 'mongoose';

export interface IPrinterDevice extends Document {
  hotelId:       mongoose.Types.ObjectId;
  deviceId:      string;
  printerName:   string | null;
  printerRole:   'kitchen' | 'cashier';
  socketId:      string | null;
  connectedAt:   Date | null;
  lastSeen:      Date | null;
  lastHeartbeat: Date | null;
}

const PrinterDeviceSchema = new Schema<IPrinterDevice>(
  {
    hotelId:       { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    deviceId:      { type: String, required: true },
    printerName:   { type: String, default: null },
    printerRole:   { type: String, enum: ['kitchen', 'cashier'], required: true },
    socketId:      { type: String, default: null },
    connectedAt:   { type: Date, default: null },
    lastSeen:      { type: Date, default: null },
    lastHeartbeat: { type: Date, default: null },
  },
  { timestamps: true },
);

// Exactly one registered printer per role per hotel — last registration wins
PrinterDeviceSchema.index({ hotelId: 1, printerRole: 1 }, { unique: true });
// Efficient disconnect cleanup by socketId
PrinterDeviceSchema.index({ socketId: 1 }, { sparse: true });

export default mongoose.model<IPrinterDevice>('PrinterDevice', PrinterDeviceSchema);
