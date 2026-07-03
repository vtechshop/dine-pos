import mongoose, { Schema } from 'mongoose';

// Atomic daily sequence counter used by generateOrderNumber.
// key = "<PREFIX>-<YYYYMMDD>-<hotelId>"  e.g. "ORD-20260703-6639f..."
// seq is incremented atomically via $inc + upsert — no race condition possible.
const DailyCounterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export default mongoose.model('DailyCounter', DailyCounterSchema);
