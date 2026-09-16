import mongoose, { Document, Schema } from 'mongoose';

/**
 * Branch-level override for an organization-shared product.
 *
 * An HQ admin creates Products under the org hotel.
 * BranchProductConfig records control which branches see each product
 * and at what price. The product document itself is never duplicated.
 *
 * - orgHotelId   : the HQ Hotel._id (owner of the product master)
 * - productId    : ref to Product (whose hotelId = orgHotelId)
 * - branchHotelId: the branch Hotel._id this config row applies to
 * - enabled      : false = branch cannot sell this product
 * - sellingPrice : branch-specific price; undefined = inherit Product.price
 * - displayOrder : branch-specific sort position in POS catalog
 */
export interface IBranchProductConfig extends Document {
  orgHotelId:    mongoose.Types.ObjectId;
  productId:     mongoose.Types.ObjectId;
  branchHotelId: mongoose.Types.ObjectId;
  enabled:       boolean;
  sellingPrice?: number;
  displayOrder?: number;
  createdAt:     Date;
  updatedAt:     Date;
}

const BranchProductConfigSchema = new Schema<IBranchProductConfig>(
  {
    orgHotelId:    { type: Schema.Types.ObjectId, required: true, index: true },
    productId:     { type: Schema.Types.ObjectId, required: true, ref: 'Product', index: true },
    branchHotelId: { type: Schema.Types.ObjectId, required: true, index: true },
    enabled:       { type: Boolean, default: true, required: true },
    sellingPrice:  { type: Number, min: 0 },
    displayOrder:  { type: Number, min: 0 },
  },
  { timestamps: true },
);

// One config row per (org, branch, product)
BranchProductConfigSchema.index(
  { orgHotelId: 1, branchHotelId: 1, productId: 1 },
  { unique: true },
);

// Fast read path: given a branchHotelId, get all its product configs
BranchProductConfigSchema.index({ branchHotelId: 1, enabled: 1, productId: 1 });

// Fast read path: given an org + product, see all branch configs (HQ catalog view)
BranchProductConfigSchema.index({ orgHotelId: 1, productId: 1 });

export default mongoose.model<IBranchProductConfig>(
  'BranchProductConfig',
  BranchProductConfigSchema,
);
