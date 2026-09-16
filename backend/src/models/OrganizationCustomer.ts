/**
 * OrganizationCustomer — Sprint MB-S4
 *
 * Org-level customer identity. Links multiple branch CustomerProfile records
 * for the same physical customer, but ONLY via explicit staff action.
 *
 * Safety invariants:
 *  - NEVER auto-create or auto-link based on phone/email match alone
 *  - NEVER auto-merge CustomerProfile records
 *  - NEVER alter loyalty balances on link/unlink
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IOrganizationCustomer extends Document {
  orgHotelId:     mongoose.Types.ObjectId;  // HQ hotel
  canonicalPhone: string | null;            // normalized digits, no spaces/dashes
  canonicalEmail: string | null;            // lowercase trimmed
  displayName:    string;
  status:         'active' | 'suspended';
  orgLoyaltyBalance: number;            // org-wide loyalty balance (server-authoritative)
  createdAt:      Date;
  updatedAt:      Date;
}

const OrganizationCustomerSchema = new Schema<IOrganizationCustomer>(
  {
    orgHotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    canonicalPhone: { type: String, default: null, trim: true },
    canonicalEmail: { type: String, default: null, lowercase: true, trim: true },
    displayName:    { type: String, default: '', maxlength: 200 },
    status:         { type: String, enum: ['active', 'suspended'], default: 'active' },
    orgLoyaltyBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Phone uniqueness per org (sparse: null phones don't conflict)
OrganizationCustomerSchema.index({ orgHotelId: 1, canonicalPhone: 1 }, { unique: true, sparse: true });
// Email lookup
OrganizationCustomerSchema.index({ orgHotelId: 1, canonicalEmail: 1 }, { sparse: true });
// Status filter
OrganizationCustomerSchema.index({ orgHotelId: 1, status: 1 });

export default mongoose.model<IOrganizationCustomer>('OrganizationCustomer', OrganizationCustomerSchema);
