/**
 * CategoryConfig — Sprint MB-S4
 *
 * Branch-level category visibility override. Default semantics:
 *   - No document present → category is VISIBLE at this branch (default enabled)
 *   - Document with enabled=false → category is HIDDEN at this branch
 *
 * Same additive pattern as BranchProductConfig. Only creates a record
 * when a branch deviates from the default (visible).
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICategoryConfig extends Document {
  orgHotelId:    mongoose.Types.ObjectId;  // HQ hotel that owns the category
  branchHotelId: mongoose.Types.ObjectId;  // branch this config is for
  categoryId:    mongoose.Types.ObjectId;  // ref to Category (owned by orgHotelId)
  enabled:       boolean;                  // false = hidden at this branch
  displayOrder?: number;                   // optional override
}

const CategoryConfigSchema = new Schema<ICategoryConfig>(
  {
    orgHotelId:    { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    branchHotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    categoryId:    { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    enabled:       { type: Boolean, required: true, default: true },
    displayOrder:  { type: Number },
  },
  { timestamps: true },
);

// Primary unique constraint per branch per category
CategoryConfigSchema.index(
  { orgHotelId: 1, branchHotelId: 1, categoryId: 1 },
  { unique: true },
);
// Query: all configs for a branch
CategoryConfigSchema.index({ branchHotelId: 1, enabled: 1 });
// Query: all configs for an org's category across branches
CategoryConfigSchema.index({ orgHotelId: 1, categoryId: 1 });

export default mongoose.model<ICategoryConfig>('CategoryConfig', CategoryConfigSchema);
