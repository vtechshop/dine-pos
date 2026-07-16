import mongoose, { Schema, Document } from 'mongoose';

export type CustomerStatus = 'active' | 'blocked' | 'merged';
export type CustomerIdentificationMode = 'disabled' | 'name_only' | 'name_mobile';

export interface ICustomerProfile extends Document {
  hotelId: mongoose.Types.ObjectId;
  customerId: string;          // human-readable: "CUST-<hotelShortId>-<seq>"
  name: string;
  phone: string | null;        // E.164 format; unique per hotel (sparse)
  email: string | null;
  birthday: string | null;     // "MM-DD" — no year; enables birthday campaign queries
  tags: string[];
  marketingOptIn: boolean;
  loyaltyBalance: number;      // denormalised from LoyaltyTransaction ledger
  lifetimeSpend: number;       // INR; incremented on guest billing
  visitCount: number;          // incremented when a session containing this customer closes
  lastVisitAt: Date | null;
  firstVisitAt: Date;
  status: CustomerStatus;
  mergedIntoId: mongoose.Types.ObjectId | null;  // set when status='merged'
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerProfileSchema: Schema = new Schema(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    customerId:     { type: String, required: true, maxlength: 50 },
    name:           { type: String, required: true, maxlength: 100 },
    phone:          { type: String, default: null },
    email:          { type: String, default: null },
    birthday:       { type: String, default: null, validate: {
                        validator: (v: string | null) => v === null || /^\d{2}-\d{2}$/.test(v),
                        message: 'birthday must be in MM-DD format',
                      }},
    tags:           [{ type: String, maxlength: 50 }],
    marketingOptIn: { type: Boolean, default: false },
    loyaltyBalance: { type: Number, default: 0, min: 0 },
    lifetimeSpend:  { type: Number, default: 0, min: 0 },
    visitCount:     { type: Number, default: 0, min: 0 },
    lastVisitAt:    { type: Date, default: null },
    firstVisitAt:   { type: Date, default: () => new Date() },
    status:         { type: String, enum: ['active', 'blocked', 'merged'], default: 'active' },
    mergedIntoId:   { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
    notes:          { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

// ── Indexes (per Architecture v1.1 §3.1) ────────────────────────────────────
// Primary identity key: phone is unique per hotel (sparse = null phones don't conflict)
CustomerProfileSchema.index({ hotelId: 1, phone: 1 }, { unique: true, sparse: true });
// Human-readable ID uniqueness per hotel
CustomerProfileSchema.index({ hotelId: 1, customerId: 1 }, { unique: true });
// Name text search (used by staff lookup)
CustomerProfileSchema.index({ hotelId: 1, name: 'text' });
// Active customer list sorted by recency
CustomerProfileSchema.index({ hotelId: 1, status: 1, lastVisitAt: -1 });
// Top loyalty customers report
CustomerProfileSchema.index({ hotelId: 1, loyaltyBalance: -1 });
// Top spenders report
CustomerProfileSchema.index({ hotelId: 1, lifetimeSpend: -1 });
// Birthday campaign queries: regex "^07-" matches all July birthdays
CustomerProfileSchema.index({ hotelId: 1, birthday: 1 }, { sparse: true });
// Tag-based customer segmentation
CustomerProfileSchema.index({ hotelId: 1, tags: 1 }, { sparse: true });

export default mongoose.model<ICustomerProfile>('CustomerProfile', CustomerProfileSchema);
