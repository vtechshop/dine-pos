/**
 * Org Customer Routes — Sprint MB-S4
 *
 * Manages org-level customer identity (OrganizationCustomer).
 * Linking is EXPLICIT ONLY — never auto-link on phone/email match.
 * Existing branch CustomerProfile records are NEVER modified auto-magically.
 *
 * Route prefix: /api/org-customers
 */
import { Router, Response } from 'express';
import mongoose from 'mongoose';
import OrganizationCustomer from '../models/OrganizationCustomer';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── Derive org context from JWT hotel ─────────────────────────────────────────

async function resolveOrg(hotelId: string): Promise<{ orgHotelId: string; isHQ: boolean } | null> {
  const hotel = await Hotel.findById(hotelId).select('parentHotelId features').lean();
  if (!hotel) return null;
  const isHQ = !hotel.parentHotelId;
  const orgHotelId = isHQ ? hotelId : hotel.parentHotelId!.toString();
  if (!isHQ) {
    const orgHotel = await Hotel.findById(orgHotelId).select('features').lean();
    if (!orgHotel?.features?.multiBranch) return null;
  } else if (!hotel.features?.multiBranch) {
    return null;
  }
  return { orgHotelId, isHQ };
}

// ── GET /api/org-customers?phone=&email= ──────────────────────────────────────
// Search org-level customers by normalized phone or email.

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    const { phone, email, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    const filter: Record<string, any> = {
      orgHotelId: new mongoose.Types.ObjectId(ctx.orgHotelId),
      status: 'active',
    };
    if (phone) filter.canonicalPhone = phone.replace(/\D/g, '').slice(-10);
    if (email) filter.canonicalEmail = email.toLowerCase().trim();

    const [customers, total] = await Promise.all([
      OrganizationCustomer.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      OrganizationCustomer.countDocuments(filter),
    ]);

    res.json({ customers, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to search org customers', err);
  }
});

// ── GET /api/org-customers/candidates/:profileId ──────────────────────────────
// Find potential org-customer matches for a branch CustomerProfile (for staff to review).
// Returns existing org customer with matching phone/email — staff must confirm the link.

router.get('/candidates/:profileId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    if (!mongoose.isValidObjectId(req.params.profileId)) {
      res.status(400).json({ message: 'Invalid profileId' });
      return;
    }

    const profile = await CustomerProfile.findById(req.params.profileId)
      .select('phone email name orgCustomerId hotelId')
      .lean();
    if (!profile) { res.status(404).json({ message: 'Customer profile not found' }); return; }

    if (profile.orgCustomerId) {
      res.json({ alreadyLinked: true, orgCustomerId: profile.orgCustomerId, candidates: [] });
      return;
    }

    // Search by phone or email — return matches for staff to decide
    const conditions: Record<string, any>[] = [];
    if (profile.phone) {
      const normalized = String(profile.phone).replace(/\D/g, '').slice(-10);
      if (normalized) conditions.push({ canonicalPhone: normalized });
    }
    if (profile.email) {
      conditions.push({ canonicalEmail: String(profile.email).toLowerCase().trim() });
    }

    if (conditions.length === 0) {
      res.json({ alreadyLinked: false, candidates: [] });
      return;
    }

    const orgObjId = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const candidates = await OrganizationCustomer.find({
      orgHotelId: orgObjId,
      $or: conditions,
    }).lean();

    res.json({ alreadyLinked: false, profileId: req.params.profileId, candidates });
  } catch (err) {
    sendError(res, 500, 'Failed to find candidates', err);
  }
});

// ── GET /api/org-customers/:id ─────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: 'Org customer not found' });
      return;
    }

    const orgCustomer = await OrganizationCustomer.findOne({
      _id: req.params.id,
      orgHotelId: new mongoose.Types.ObjectId(ctx.orgHotelId),
    }).lean();
    if (!orgCustomer) { res.status(404).json({ message: 'Org customer not found' }); return; }

    // Fetch linked branch profiles
    const linkedProfiles = await CustomerProfile.find({ orgCustomerId: orgCustomer._id })
      .select('_id customerId name phone email hotelId loyaltyBalance visitCount lastVisitAt status')
      .lean();

    res.json({ orgCustomer, linkedProfiles });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch org customer', err);
  }
});

// ── POST /api/org-customers ────────────────────────────────────────────────────
// Create a new org-level customer identity. Does NOT auto-link any profiles.

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    const { displayName, phone, email } = req.body as Record<string, string>;

    const canonicalPhone = phone ? String(phone).replace(/\D/g, '').slice(-10) || null : null;
    const canonicalEmail = email ? String(email).toLowerCase().trim() || null : null;

    const orgCustomer = await OrganizationCustomer.create({
      orgHotelId: new mongoose.Types.ObjectId(ctx.orgHotelId),
      displayName: displayName ? String(displayName).trim().slice(0, 200) : '',
      canonicalPhone,
      canonicalEmail,
    });

    logAudit(req, 'org_customer.create', 'OrganizationCustomer', orgCustomer._id.toString(), { displayName, canonicalPhone });
    res.status(201).json({ orgCustomer });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ message: 'An org customer with this phone already exists' });
      return;
    }
    sendError(res, 500, 'Failed to create org customer', err);
  }
});

// ── POST /api/org-customers/:id/link ──────────────────────────────────────────
// Explicitly link a branch CustomerProfile to this org customer.
// Staff must confirm the link — this endpoint is the explicit action.
// Loyalty balances and other profile data are NEVER modified.

router.post('/:id/link', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    const { profileId } = req.body as { profileId?: string };
    if (!profileId || !mongoose.isValidObjectId(profileId)) {
      res.status(400).json({ message: 'profileId is required' });
      return;
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: 'Org customer not found' });
      return;
    }

    const orgObjId = new mongoose.Types.ObjectId(ctx.orgHotelId);

    // Verify org customer belongs to this org
    const orgCustomer = await OrganizationCustomer.findOne({ _id: req.params.id, orgHotelId: orgObjId }).lean();
    if (!orgCustomer) { res.status(404).json({ message: 'Org customer not found' }); return; }

    // Verify the profile belongs to a hotel in this org (HQ or any branch)
    const profile = await CustomerProfile.findById(profileId).select('hotelId orgCustomerId name').lean();
    if (!profile) { res.status(404).json({ message: 'Customer profile not found' }); return; }

    const profileHotelId = profile.hotelId.toString();
    const orgBranchIds = await Hotel.find({ parentHotelId: orgObjId }).select('_id').lean();
    const validHotelIds = new Set([ctx.orgHotelId, ...orgBranchIds.map(b => b._id.toString())]);
    if (!validHotelIds.has(profileHotelId)) {
      res.status(403).json({ message: 'Profile does not belong to this organization' });
      return;
    }

    if (profile.orgCustomerId?.toString() === req.params.id) {
      res.json({ message: 'Already linked', orgCustomerId: req.params.id });
      return;
    }

    // Explicit link — no loyalty transfer, no profile modification beyond orgCustomerId
    await CustomerProfile.findByIdAndUpdate(profileId, {
      $set: { orgCustomerId: new mongoose.Types.ObjectId(req.params.id) },
    });

    logAudit(req, 'org_customer.link', 'OrganizationCustomer', req.params.id, { profileId, hotelId: profileHotelId });
    res.json({ success: true, orgCustomerId: req.params.id, profileId });
  } catch (err) {
    sendError(res, 500, 'Failed to link profile', err);
  }
});

// ── DELETE /api/org-customers/:id/links/:profileId ────────────────────────────
// Explicitly unlink a branch CustomerProfile from this org customer.

router.delete('/:id/links/:profileId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) { res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' }); return; }

    const { id, profileId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(profileId)) {
      res.status(400).json({ message: 'Invalid id or profileId' });
      return;
    }

    const orgObjId = new mongoose.Types.ObjectId(ctx.orgHotelId);
    const orgCustomer = await OrganizationCustomer.findOne({ _id: id, orgHotelId: orgObjId }).lean();
    if (!orgCustomer) { res.status(404).json({ message: 'Org customer not found' }); return; }

    const result = await CustomerProfile.findOneAndUpdate(
      { _id: profileId, orgCustomerId: new mongoose.Types.ObjectId(id) },
      { $set: { orgCustomerId: null } },
    );
    if (!result) { res.status(404).json({ message: 'Profile not found or not linked to this org customer' }); return; }

    logAudit(req, 'org_customer.unlink', 'OrganizationCustomer', id, { profileId });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to unlink profile', err);
  }
});

// ── GET /api/org-customers/:id/loyalty ───────────────────────────────────────
// Paginated organization loyalty history for a single org customer.
// Auth: admin (already applied at router level)
// Org-scoped: orgCustomer.orgHotelId must match the JWT-derived org hotel.
// Never trusts client-supplied orgHotelId or branchHotelId.

router.get('/:id/loyalty', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await resolveOrg(req.hotelId!);
    if (!ctx) {
      res.status(403).json({ message: 'Multi-branch not enabled or hotel not found' });
      return;
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: 'Invalid org customer id' });
      return;
    }

    // Verify the org customer belongs to this organization (server-authoritative)
    const orgCustomer = await OrganizationCustomer.findOne({
      _id:       new mongoose.Types.ObjectId(req.params.id),
      orgHotelId: new mongoose.Types.ObjectId(ctx.orgHotelId),
    }).lean();

    if (!orgCustomer) {
      res.status(404).json({ message: 'Organization customer not found' });
      return;
    }

    const page      = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1);
    const limitNum  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const skip      = (page - 1) * limitNum;

    const filter = { orgCustomerId: orgCustomer._id };

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('transactionType points balanceAfter remarks branchHotelId orderId sessionId guestId createdBy expiresAt createdAt')
        .lean(),
      LoyaltyTransaction.countDocuments(filter),
    ]);

    res.json({
      orgCustomer: {
        _id:               orgCustomer._id,
        displayName:       orgCustomer.displayName,
        canonicalPhone:    orgCustomer.canonicalPhone,
        orgLoyaltyBalance: orgCustomer.orgLoyaltyBalance,
        status:            orgCustomer.status,
      },
      transactions,
      total,
      page,
      limit: limitNum,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch org loyalty history', err);
  }
});

// ── PATCH /api/settings/org-loyalty (mounted at settings, but for features) ──
// This is intentionally in orgCustomerRoutes so HQ admin can also manage
// per-branch orgLoyaltyEnabled. See settingsRoutes.ts for the HQ master switch.

export default router;
