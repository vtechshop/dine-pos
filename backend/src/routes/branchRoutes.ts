import { Router, Response } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Hotel from '../models/Hotel';
import Settings from '../models/Settings';
import { authMiddleware, requireAdmin, AuthRequest, generateToken, generateRefreshToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

// ── Authorization helper ──────────────────────────────────────────────────────

interface MultibranchAccess {
  enabled: boolean;
  maxBranches: number;
}

async function resolveMultiBranchAccess(hotelId: string): Promise<MultibranchAccess> {
  const hotel = await Hotel.findById(hotelId)
    .select('features maxBranches')
    .lean() as any;
  if (!hotel) return { enabled: false, maxBranches: 0 };
  return {
    enabled: !!(hotel.features?.multiBranch),
    maxBranches: hotel.maxBranches ?? 1,
  };
}

async function checkMultiBranch(req: AuthRequest, res: Response): Promise<boolean> {
  const { enabled } = await resolveMultiBranchAccess(req.hotelId!);
  if (!enabled) {
    res.status(403).json({
      code: 'FEATURE_DISABLED',
      message: "The 'multiBranch' feature is not enabled for your plan. Contact support to upgrade.",
    });
    return false;
  }
  return true;
}

function badBranchId(res: Response): void {
  res.status(400).json({ message: 'Invalid branch ID' });
}

// ── List branches ─────────────────────────────────────────────────────────────

// GET /api/branches
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;

    const parentId = new mongoose.Types.ObjectId(req.hotelId!);
    const branches = await Hotel.find({ parentHotelId: parentId })
      .select('-adminPasswordHash')
      .sort({ createdAt: 1 })
      .lean();

    res.json({ branches, total: branches.length });
  } catch (e) {
    logger.error('[branches] GET / error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/branches/count — lightweight stat for the dashboard
router.get('/count', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parentId = new mongoose.Types.ObjectId(req.hotelId!);
    const [count, hq] = await Promise.all([
      Hotel.countDocuments({ parentHotelId: parentId }),
      Hotel.findById(req.hotelId!).select('maxBranches isHeadquarters features').lean() as any,
    ]);
    res.json({
      count,
      maxBranches:         hq?.maxBranches ?? 1,
      isHeadquarters:      !!(hq?.isHeadquarters),
      multiBranchEnabled:  !!(hq?.features?.multiBranch),
    });
  } catch (e) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Create branch ─────────────────────────────────────────────────────────────

// POST /api/branches
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;

    const {
      branchName, branchCode, adminId, adminPassword,
      address, phone, city, state, pincode, gstNumber, timezone,
    } = req.body;

    // Input validation
    if (!branchName || typeof branchName !== 'string' || !branchName.trim()) {
      res.status(400).json({ message: 'branchName is required' });
      return;
    }
    if (!adminId || typeof adminId !== 'string' || !adminId.trim()) {
      res.status(400).json({ message: 'adminId is required for the new branch' });
      return;
    }
    if (!adminPassword || typeof adminPassword !== 'string' || adminPassword.length < 6) {
      res.status(400).json({ message: 'adminPassword must be at least 6 characters' });
      return;
    }

    // Fetch parent hotel — needed for limit check and field inheritance
    const parentHotel = await Hotel.findById(req.hotelId!)
      .select('maxBranches hotelName ownerName status features timezone businessType')
      .lean() as any;
    if (!parentHotel) { res.status(404).json({ message: 'Parent hotel not found' }); return; }

    // Enforce branch limit — server-side; never trust client-supplied count
    const existingCount = await Hotel.countDocuments({
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    const limit = parentHotel.maxBranches ?? 1;
    if (existingCount >= limit) {
      res.status(429).json({
        code: 'BRANCH_LIMIT_REACHED',
        message: `Your plan allows a maximum of ${limit} branch(es). Contact support to increase your limit.`,
        current: existingCount,
        max: limit,
      });
      return;
    }

    // adminId uniqueness — same global uniqueness constraint as standalone hotels
    const adminIdConflict = await Hotel.findOne({ adminId: adminId.trim() }).lean();
    if (adminIdConflict) {
      res.status(409).json({ message: 'This Admin ID is already in use. Choose a different one.' });
      return;
    }

    // branchCode: strip non-alphanumeric, uppercase, validate uniqueness within org
    const code = (branchCode || '').toString().trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (code) {
      const codeConflict = await Hotel.findOne({
        parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
        branchCode: code,
      }).lean();
      if (codeConflict) {
        res.status(409).json({ message: 'Branch code already used within this organization. Choose a different one.' });
        return;
      }
    }

    const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

    // Create the branch as a new Hotel document
    const branch = new Hotel({
      hotelName:      branchName.trim(),
      branchName:     branchName.trim(),
      branchCode:     code,
      parentHotelId:  new mongoose.Types.ObjectId(req.hotelId!),
      isHeadquarters: false,
      maxBranches:    0,   // branches cannot have sub-branches

      // Inherit structural fields from parent
      ownerName:    parentHotel.ownerName || branchName.trim(),
      businessType: parentHotel.businessType || 'restaurant',
      timezone:     (timezone || '').trim() || parentHotel.timezone || 'Asia/Kolkata',

      // Location fields from request body
      phone:    (phone    || '').toString().trim(),
      address:  (address  || '').toString().trim(),
      city:     (city     || '').toString().trim(),
      state:    (state    || '').toString().trim(),
      pincode:  (pincode  || '').toString().trim(),
      gstNumber:(gstNumber|| '').toString().trim(),

      // Credentials
      adminId:           adminId.trim(),
      adminPasswordHash,

      // Status: active if parent is active/trial; otherwise mirror parent
      status: ['active', 'trial'].includes(parentHotel.status) ? 'active' : parentHotel.status,

      // Features: default all false for branches; branch admin enables via Settings
      features: { multiBranch: false },
    });

    await branch.save();

    // Create minimal Settings document so branch admin can log in without errors
    await Settings.findOneAndUpdate(
      { hotelId: branch._id },
      { $setOnInsert: { hotelId: branch._id, hotelName: branchName.trim(), isSetupComplete: false } },
      { upsert: true },
    );

    // Mark HQ as isHeadquarters once its first branch exists
    await Hotel.findByIdAndUpdate(req.hotelId!, { $set: { isHeadquarters: true } });

    const { adminPasswordHash: _removed, ...safeResult } = branch.toObject();
    res.status(201).json({ branch: safeResult, message: 'Branch created successfully' });
  } catch (e: any) {
    if (e.code === 11000) {
      res.status(409).json({ message: 'Branch code or Admin ID conflict. Please choose different values.' });
      return;
    }
    logger.error('[branches] POST / error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Org context + branch switching ───────────────────────────────────────────

// GET /api/branches/context — returns the org structure visible from any context
// Works with both HQ and branch tokens; does NOT require multiBranch feature.
router.get('/context', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId!;
    const hotel = await Hotel.findById(hotelId)
      .select('parentHotelId isHeadquarters hotelName branchName branchCode features maxBranches')
      .lean() as any;
    if (!hotel) { res.status(404).json({ message: 'Hotel not found' }); return; }

    // Determine the org root regardless of whether we're in HQ or branch context
    const isHQ = !hotel.parentHotelId;
    const orgHotelId: string = isHQ ? hotelId : hotel.parentHotelId.toString();

    const [branches, orgHotel] = await Promise.all([
      Hotel.find({ parentHotelId: new mongoose.Types.ObjectId(orgHotelId) })
        .select('_id hotelName branchName branchCode status isHeadquarters createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      isHQ ? Promise.resolve(hotel) : Hotel.findById(orgHotelId)
        .select('hotelName branchName isHeadquarters features')
        .lean() as Promise<any>,
    ]);

    res.json({
      orgHotelId,
      orgHotelName:      (orgHotel as any)?.hotelName || '',
      isHeadquarters:    isHQ,
      currentBranchId:   isHQ ? null : hotelId,
      multiBranchEnabled: !!(orgHotel as any)?.features?.multiBranch,
      branches,
    });
  } catch (e) {
    logger.error('[branches] GET /context error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/branches/switch — generate a branch-scoped admin token
// Validates that the target branch belongs to the caller's organization.
router.post('/switch', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId } = req.body;
    if (!branchId || !mongoose.isValidObjectId(branchId)) {
      res.status(400).json({ message: 'branchId is required and must be a valid ID' });
      return;
    }

    // Determine the org root from the current token
    const currentHotel = await Hotel.findById(req.hotelId!)
      .select('parentHotelId features')
      .lean() as any;
    if (!currentHotel) { res.status(404).json({ message: 'Hotel not found' }); return; }

    const orgHotelId: string = currentHotel.parentHotelId
      ? currentHotel.parentHotelId.toString()
      : req.hotelId!;

    // Check multiBranch is enabled at the org level
    const orgHotel = await Hotel.findById(orgHotelId)
      .select('hotelName features')
      .lean() as any;
    if (!orgHotel?.features?.multiBranch) {
      res.status(403).json({
        code: 'FEATURE_DISABLED',
        message: "Multi-branch switching is not enabled for this organization.",
      });
      return;
    }

    // Verify the target branch belongs to this org — server-enforced, never trusts client
    const branch = await Hotel.findOne({
      _id: new mongoose.Types.ObjectId(branchId),
      parentHotelId: new mongoose.Types.ObjectId(orgHotelId),
    }).select('hotelName branchName branchCode status').lean() as any;

    if (!branch) {
      res.status(403).json({ message: 'Branch not found or not accessible' });
      return;
    }
    if (branch.status === 'suspended') {
      res.status(403).json({ code: 'BRANCH_SUSPENDED', message: 'This branch is currently deactivated.' });
      return;
    }
    if (!['active', 'trial'].includes(branch.status)) {
      res.status(403).json({ message: 'Branch is not operational.' });
      return;
    }

    const branchToken = generateToken(branchId, branch.hotelName);
    const { token: branchRefreshToken } = await generateRefreshToken(branchId);

    res.json({
      branchToken,
      branchRefreshToken,
      branchId,
      branchName:   branch.branchName || branch.hotelName,
      branchCode:   branch.branchCode || '',
      orgHotelId,
      orgHotelName: orgHotel.hotelName,
    });
  } catch (e) {
    logger.error('[branches] POST /switch error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Single-branch ops ─────────────────────────────────────────────────────────

// GET /api/branches/:branchId
router.get('/:branchId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.branchId)) { badBranchId(res); return; }

    const branch = await Hotel.findOne({
      _id: new mongoose.Types.ObjectId(req.params.branchId),
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    }).select('-adminPasswordHash').lean();

    if (!branch) { res.status(404).json({ message: 'Branch not found or not accessible' }); return; }
    res.json({ branch });
  } catch (e) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/branches/:branchId — update branch details
router.put('/:branchId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.branchId)) { badBranchId(res); return; }

    const branch = await Hotel.findOne({
      _id: new mongoose.Types.ObjectId(req.params.branchId),
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!branch) { res.status(404).json({ message: 'Branch not found' }); return; }

    const { branchName, address, phone, city, state, pincode, gstNumber, timezone } = req.body;
    const update: Record<string, unknown> = {};
    if (branchName)          { update.branchName = String(branchName).trim(); update.hotelName = String(branchName).trim(); }
    if (address   !== undefined) update.address   = String(address).trim();
    if (phone     !== undefined) update.phone     = String(phone).trim();
    if (city      !== undefined) update.city      = String(city).trim();
    if (state     !== undefined) update.state     = String(state).trim();
    if (pincode   !== undefined) update.pincode   = String(pincode).trim();
    if (gstNumber !== undefined) update.gstNumber = String(gstNumber).trim();
    if (timezone  !== undefined) update.timezone  = String(timezone).trim();

    const updated = await Hotel.findByIdAndUpdate(branch._id, { $set: update }, { new: true })
      .select('-adminPasswordHash')
      .lean();

    res.json({ branch: updated });
  } catch (e) {
    logger.error('[branches] PUT /:branchId error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/branches/:branchId/deactivate — soft deactivate (financial history preserved)
router.post('/:branchId/deactivate', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.branchId)) { badBranchId(res); return; }

    const branch = await Hotel.findOne({
      _id: new mongoose.Types.ObjectId(req.params.branchId),
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!branch) { res.status(404).json({ message: 'Branch not found' }); return; }

    await Hotel.findByIdAndUpdate(branch._id, { $set: { status: 'suspended' } });
    res.json({ message: 'Branch deactivated. All financial history is preserved.' });
  } catch (e) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/branches/:branchId/org-loyalty-enabled — HQ admin sets per-branch opt-out
// Prevents branches from managing their own org-loyalty participation (BR-2 enforcement).
router.patch('/:branchId/org-loyalty-enabled', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.branchId)) { badBranchId(res); return; }

    const { orgLoyaltyEnabled } = req.body as { orgLoyaltyEnabled?: boolean };
    if (typeof orgLoyaltyEnabled !== 'boolean') {
      res.status(400).json({ message: 'orgLoyaltyEnabled must be a boolean' });
      return;
    }

    // Verify branch belongs to this HQ organization
    const branch = await Hotel.findOne({
      _id:           new mongoose.Types.ObjectId(req.params.branchId),
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!branch) { res.status(404).json({ message: 'Branch not found' }); return; }

    await Hotel.findByIdAndUpdate(branch._id, { $set: { 'features.orgLoyaltyEnabled': orgLoyaltyEnabled } });

    res.json({ message: 'Branch org loyalty participation updated', branchId: branch._id, orgLoyaltyEnabled });
  } catch (e) {
    logger.error('[branches] PATCH /:branchId/org-loyalty-enabled error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/branches/:branchId/reactivate
router.post('/:branchId/reactivate', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!await checkMultiBranch(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.branchId)) { badBranchId(res); return; }

    const branch = await Hotel.findOne({
      _id: new mongoose.Types.ObjectId(req.params.branchId),
      parentHotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!branch) { res.status(404).json({ message: 'Branch not found' }); return; }

    if (branch.status !== 'suspended') {
      res.status(400).json({ message: 'Branch is not currently deactivated' });
      return;
    }

    await Hotel.findByIdAndUpdate(branch._id, { $set: { status: 'active' } });
    res.json({ message: 'Branch reactivated.' });
  } catch (e) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
