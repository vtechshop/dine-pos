import mongoose, { Schema, Document } from 'mongoose';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface IReservation extends Document {
  hotelId:             mongoose.Types.ObjectId;
  tableId?:            mongoose.Types.ObjectId | null;
  tableNumber?:        number | null;
  customerId?:         mongoose.Types.ObjectId | null;
  customerName:        string;
  phone:               string;
  email:               string;
  partySize:           number;
  date:                Date;
  time:                string;
  startMinutes:        number;
  durationMinutes:     number;
  status:              ReservationStatus;
  occasion:            string;
  source:              'walk_in' | 'phone' | 'website' | 'whatsapp' | 'instagram' | 'other';
  depositAmount:       number;
  depositStatus:       'none' | 'pending' | 'paid';
  notes:               string;
  cancellationReason:  string | null;
  cancelledAt:         Date | null;
  cancelledBy:         string | null;
  noShowAt:            Date | null;
  confirmedAt:         Date | null;
  arrivedAt:           Date | null;
  /** D-14: set when the guest is physically seated at the table */
  seatedAt:            Date | null;
  createdAt:           Date;
  updatedAt:           Date;
}

export function parseTimeToMinutes(time: string): number {
  const m = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

const ReservationSchema: Schema = new Schema(
  {
    hotelId:      { type: Schema.Types.ObjectId, ref: 'Hotel',           required: true, index: true },
    tableId:      { type: Schema.Types.ObjectId, ref: 'Table',           default: null },
    tableNumber:  { type: Number,  default: null },
    customerId:   { type: Schema.Types.ObjectId, ref: 'CustomerProfile', default: null },
    customerName: { type: String,  required: true, trim: true, maxlength: 120 },
    phone:        { type: String,  required: true, trim: true, maxlength: 20 },
    email:        { type: String,  default: '', trim: true, maxlength: 120 },
    partySize:    { type: Number,  required: true, min: 1, max: 200 },
    date:         { type: Date,    required: true },
    time:         { type: String,  required: true },
    startMinutes: { type: Number,  default: 0 },
    durationMinutes: { type: Number, default: 90, min: 15, max: 480 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'arrived', 'seated', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
    },
    occasion:           { type: String, default: '' },
    source: {
      type: String,
      enum: ['walk_in', 'phone', 'website', 'whatsapp', 'instagram', 'other'],
      default: 'phone',
    },
    depositAmount:      { type: Number, default: 0, min: 0 },
    depositStatus:      { type: String, enum: ['none', 'pending', 'paid'], default: 'none' },
    notes:              { type: String, default: '' },
    cancellationReason: { type: String, default: null },
    cancelledAt:        { type: Date,   default: null },
    cancelledBy:        { type: String, default: null },
    noShowAt:           { type: Date,   default: null },
    confirmedAt:        { type: Date,   default: null },
    arrivedAt:          { type: Date,   default: null },
    seatedAt:           { type: Date,   default: null },
  },
  { timestamps: true },
);

ReservationSchema.pre('save', function (next) {
  if (this.isModified('time') || this.isNew) {
    (this as any).startMinutes = parseTimeToMinutes((this as any).time as string);
  }
  next();
});

ReservationSchema.index({ hotelId: 1, date: -1 });
ReservationSchema.index({ hotelId: 1, tableId: 1, date: 1, status: 1 });
ReservationSchema.index({ hotelId: 1, status: 1, date: 1 });
// Prevent concurrent requests from double-booking the same table at the same
// time on the same date. date is included because startMinutes is time-of-day
// only (minutes from midnight) — without date, the same slot on different days
// would conflict. partialFilterExpression restricts enforcement to active
// reservations; completed / cancelled / no_show records are never excluded.
// tableId type guard skips unassigned (null) reservations.
ReservationSchema.index(
  { hotelId: 1, tableId: 1, date: 1, startMinutes: 1 },
  {
    unique: true,
    partialFilterExpression: {
      tableId: { $type: 'objectId' },
      status:  { $in: ['pending', 'confirmed', 'arrived', 'seated'] },
    },
  },
);

export default mongoose.model<IReservation>('Reservation', ReservationSchema);
