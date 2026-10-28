import Hotel from '../models/Hotel';
import { AuthRequest } from '../middleware/auth';

// Organisation (HQ) authority for multi-branch operations.
//
// Who may act for an org (switch branches, manage sibling branch config, read
// org-wide reports):
//   1. The HQ admin: caller hotel has no parentHotelId (it IS the org root).
//   2. An HQ admin acting inside one of its branches: the access token carries
//      actingOrgId (only minted by POST /api/branches/switch) AND the DB confirms
//      the caller branch's parentHotelId equals that org.
// A branch's own admin login never carries actingOrgId, so it only has
// authority over its own branch.
export interface OrgAuthority {
  orgHotelId: string;
  isHQ:       boolean;
  actsForOrg: boolean;
  multiBranchEnabled: boolean;
}

export async function resolveOrgAuthority(req: AuthRequest): Promise<OrgAuthority | null> {
  const caller = await Hotel.findById(req.hotelId!).select('parentHotelId features').lean() as any;
  if (!caller) return null;

  const isHQ = !caller.parentHotelId;
  const orgHotelId = isHQ ? String(req.hotelId) : String(caller.parentHotelId);
  const actsForOrg = isHQ || (!!req.actingOrgId && req.actingOrgId === orgHotelId);

  let multiBranchEnabled = !!caller.features?.multiBranch;
  if (!isHQ) {
    const org = await Hotel.findById(orgHotelId).select('features').lean() as any;
    multiBranchEnabled = !!org?.features?.multiBranch;
  }
  return { orgHotelId, isHQ, actsForOrg, multiBranchEnabled };
}
