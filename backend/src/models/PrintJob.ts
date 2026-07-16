import mongoose, { Schema, Document } from 'mongoose';

export type PrintJobType   = 'kot' | 'receipt';
export type PrintJobStatus = 'pending' | 'sent' | 'success' | 'failed';
export type PrinterTarget  = 'kitchen' | 'cashier';
export type PrinterMode    = 'single' | 'dual';

export interface IPrintJob extends Document {
  hotelId:        mongoose.Types.ObjectId;
  jobType:        PrintJobType;
  printerTarget:  PrinterTarget;
  printerAddress: string;
  printerMode:    PrinterMode;
  orderId:        mongoose.Types.ObjectId | null;
  guestId:        mongoose.Types.ObjectId | null;
  sessionId:      mongoose.Types.ObjectId | null;
  status:         PrintJobStatus;
  attemptCount:   number;
  sentAt:         Date | null;
  printedAt:      Date | null;
  errorMessage:   string | null;
  payload:        Record<string, any>;
  createdAt:      Date;
  updatedAt:      Date;
}

const PrintJobSchema = new Schema<IPrintJob>(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    jobType:        { type: String, enum: ['kot', 'receipt'], required: true },
    printerTarget:  { type: String, enum: ['kitchen', 'cashier'], required: true },
    printerAddress: { type: String, default: '' },
    printerMode:    { type: String, enum: ['single', 'dual'], default: 'single' },
    orderId:        { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    guestId:        { type: Schema.Types.ObjectId, ref: 'Guest', default: null },
    sessionId:      { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    status:         { type: String, enum: ['pending', 'sent', 'success', 'failed'], default: 'pending' },
    attemptCount:   { type: Number, default: 0 },
    sentAt:         { type: Date, default: null },
    printedAt:      { type: Date, default: null },
    errorMessage:   { type: String, default: null },
    payload:        { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

PrintJobSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
PrintJobSchema.index({ hotelId: 1, createdAt: -1 });

export default mongoose.model<IPrintJob>('PrintJob', PrintJobSchema);
