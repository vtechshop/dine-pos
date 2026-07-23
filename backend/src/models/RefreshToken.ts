import mongoose, { Schema, Document } from 'mongoose';

export interface IRefreshToken extends Document {
  token: string;
  hotelId: mongoose.Types.ObjectId;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const RefreshTokenSchema = new Schema<IRefreshToken>({
  token:     { type: String, required: true, unique: true },
  hotelId:   { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
  // H-9: familyId groups all tokens from a single login session. If a revoked
  // token in the family is replayed, all tokens in the family are revoked —
  // this detects token theft and forces both victim and attacker to re-login.
  familyId:  { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
});

// TTL index — MongoDB auto-deletes expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
