import mongoose, { Schema, Document } from 'mongoose';

export interface IRefreshToken extends Document {
  token: string;
  hotelId: mongoose.Types.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
}

const RefreshTokenSchema = new Schema<IRefreshToken>({
  token:     { type: String, required: true, unique: true },
  hotelId:   { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
});

// TTL index — MongoDB auto-deletes expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
