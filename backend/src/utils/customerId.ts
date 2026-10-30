import mongoose from 'mongoose';
import DailyCounter from '../models/DailyCounter';
import CustomerProfile from '../models/CustomerProfile';

/**
 * Next free customer ID for a hotel: "CUST-<last 6 of hotelId>-<seq>".
 *
 * Every place that creates a CustomerProfile (manual "New Customer", order and QR
 * auto-create) must use this one counter. They used to use two different counters
 * that both started at 1, so IDs collided and saves failed. IDs handed out before
 * that fix may be ahead of this counter, so an ID that is already taken is skipped.
 */
export async function nextCustomerId(hotelId: string): Promise<string> {
  const key = `CUST-${hotelId}`;
  const shortId = hotelId.slice(-6).toUpperCase();
  const hotelObjId = new mongoose.Types.ObjectId(hotelId);
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await DailyCounter.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 }, $setOnInsert: { key } },
      { upsert: true, new: true },
    );
    const id = `CUST-${shortId}-${String(counter!.seq).padStart(4, '0')}`;
    if (!(await CustomerProfile.exists({ hotelId: hotelObjId, customerId: id }))) return id;
  }
  throw new Error('Could not allocate a free customer ID');
}
