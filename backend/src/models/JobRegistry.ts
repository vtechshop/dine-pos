import mongoose, { Schema, Document } from 'mongoose';

export interface IJobRegistry extends Document {
  jobName:          string;
  lastRunAt:        Date;
  lastRunStatus:    'success' | 'failure' | 'running';
  lastError:        string | null;
  hotelsProcessed:  number;
  hotelsFailed:     number;
  durationMs:       number;
}

const JobRegistrySchema = new Schema<IJobRegistry>(
  {
    jobName:         { type: String, required: true },
    lastRunAt:       { type: Date, default: Date.now },
    lastRunStatus:   { type: String, enum: ['success', 'failure', 'running'], required: true },
    lastError:       { type: String, default: null },
    hotelsProcessed: { type: Number, default: 0 },
    hotelsFailed:    { type: Number, default: 0 },
    durationMs:      { type: Number, default: 0 },
  },
  { timestamps: false },
);

JobRegistrySchema.index({ jobName: 1 }, { unique: true });

export default mongoose.model<IJobRegistry>('JobRegistry', JobRegistrySchema);
