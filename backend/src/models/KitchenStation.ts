import mongoose, { Schema, Document } from 'mongoose';

export interface IKitchenStation extends Document {
  hotelId: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const KitchenStationSchema: Schema = new Schema(
  {
    hotelId:   { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name:      { type: String, required: true, trim: true, maxlength: 100 },
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

KitchenStationSchema.index({ hotelId: 1, name: 1 }, { unique: true });

export default mongoose.model<IKitchenStation>('KitchenStation', KitchenStationSchema);
