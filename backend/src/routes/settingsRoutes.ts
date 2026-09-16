import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import Settings from '../models/Settings';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest, invalidateStatusCache } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { validatePin } from '../utils/pinPolicy';
import { sendError } from '../utils/sendError';

const router = Router();

router.use(authMiddleware);

// Fields that must never be returned to non-admin roles (kitchen, cashier, waiter).
// kitchenPin is a bcrypt hash — knowing it enables offline brute-force of the 4-digit PIN.
// Bank/PAN/GST fields are sensitive business data with no operational need for staff devices.
const ADMIN_ONLY_FIELDS = new Set([
  'kitchenPin', 'bankAccountNumber', 'bankIfscCode', 'bankAccountHolder',
  'panNumber', 'fssaiNumber', 'gstNumber', 'upiId',
]);

// Settings that a branch inherits from HQ when the branch has not set them.
// Excludes all sensitive/credential fields and device-specific fields.
const INHERITABLE_FROM_HQ = new Set([
  'loyaltySettings', 'defaultTaxPercent', 'currencySymbol', 'currency',
  'businessType', 'footerText', 'printerWidth',
]);

// GET settings for this hotel — includes premium status from Hotel record.
// For branches with multiBranch enabled, inherits approved fields from HQ settings
// when the branch has not set them. Sensitive/credential fields are never inherited.
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Run both queries in parallel — they have no data dependency
    const [settingsDoc, hotel] = await Promise.all([
      Settings.findOne({ hotelId: req.hotelId }),
      Hotel.findById(req.hotelId).select('isPremium premiumPlan premiumExpiry trialEndsAt features parentHotelId'),
    ]);
    // Atomic upsert prevents the E11000 duplicate-key race on first-time hotel setup
    const settings = settingsDoc ?? await Settings.findOneAndUpdate(
      { hotelId: req.hotelId },
      { $setOnInsert: { hotelId: req.hotelId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const now = new Date();
    const isPremiumActive =
      hotel?.isPremium &&
      (!hotel.premiumExpiry || hotel.premiumExpiry > now);
    const isTrialActive =
      !hotel?.isPremium &&
      hotel?.trialEndsAt != null &&
      hotel.trialEndsAt > now;

    const settingsObj = settings!.toObject() as Record<string, any>;

    // ── Settings inheritance: branch inherits approved HQ defaults ───────────
    // Only activated when the caller is a branch (parentHotelId set) and
    // the org has multiBranch enabled. Non-branch hotels are unaffected.
    if (hotel?.parentHotelId && hotel.features?.multiBranch) {
      const orgHotelId = hotel.parentHotelId.toString();
      const orgSettings = await Settings.findOne({ hotelId: orgHotelId }).lean();
      if (orgSettings) {
        for (const field of INHERITABLE_FROM_HQ) {
          // Only inherit when the branch has not set the field (null/undefined/0/"")
          const branchVal = settingsObj[field];
          const isEmpty = branchVal === null || branchVal === undefined || branchVal === '' || branchVal === 0;
          if (isEmpty && orgSettings[field as keyof typeof orgSettings] != null) {
            settingsObj[field] = orgSettings[field as keyof typeof orgSettings];
            settingsObj[`_inheritedFromOrg`] = settingsObj['_inheritedFromOrg']
              ? [...settingsObj['_inheritedFromOrg'], field]
              : [field];
          }
        }
      }
    }

    // isOrgBranch: caller is a branch within a multiBranch organization
    const isOrgBranch = !!(hotel?.parentHotelId && hotel.features?.multiBranch);

    const payload: Record<string, any> = {
      ...settingsObj,
      isPremium: isPremiumActive || isTrialActive || false,
      premiumPlan: hotel?.premiumPlan || 'free',
      premiumExpiry: hotel?.premiumExpiry || null,
      trialEndsAt: hotel?.trialEndsAt || null,
      features: hotel?.features ?? {},
      qrAppUrl: process.env.QR_APP_URL || 'https://dine-pos-qr-rho.vercel.app',
      isOrgBranch,
    };

    // Strip sensitive fields for non-admin callers (kitchen, cashier, waiter tablets)
    if (req.role !== 'admin') {
      for (const field of ADMIN_ONLY_FIELDS) delete payload[field];
    }

    res.json(payload);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

const SETTINGS_ALLOWED_FIELDS = new Set([
  'hotelName', 'ownerName', 'businessType', 'phone', 'email', 'address',
  'hotelLogo', 'roleImageAdmin', 'roleImageCustomer', 'roleImageStaff',
  'currencySymbol', 'currency', 'defaultTaxPercent', 'printerWidth', 'footerText',
  'qrGuestTimeoutMinutes', 'gstNumber', 'fssaiNumber', 'panNumber',
  'bankName', 'bankAccountNumber', 'bankIfscCode', 'bankAccountHolder', 'upiId',
  'printerMode', 'kitchenPrinterAddress', 'cashierPrinterAddress', 'kotAutoPrint',
  'loyaltySettings', 'kitchenPin',
]);

// PUT update settings for this hotel
router.put('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const body: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (SETTINGS_ALLOWED_FIELDS.has(k)) body[k] = v;
    }
    if (body.kitchenPin && typeof body.kitchenPin === 'string') {
      const pinCheck = validatePin(body.kitchenPin);
      if (!pinCheck.valid) {
        return res.status(400).json({ message: pinCheck.message });
      }
      body.kitchenPin = await bcrypt.hash(body.kitchenPin, 12);
    }
    // Printer addresses are set per-device. Don't overwrite an existing address
    // with an empty string when a different device (that doesn't know the other
    // device's address) saves settings.
    if (!body.kitchenPrinterAddress)  delete body.kitchenPrinterAddress;
    if (!body.cashierPrinterAddress)  delete body.cashierPrinterAddress;
    if (!body.kitchenPin)             delete body.kitchenPin;
    const settings = await Settings.findOneAndUpdate(
      { hotelId: req.hotelId },
      { ...body, hotelId: req.hotelId },
      { new: true, upsert: true, runValidators: true }
    );

    // Keep Hotel record in sync so Super Admin dashboard shows the latest name/phone
    const syncFields: Record<string, any> = {};
    if (req.body.hotelName)  syncFields.hotelName  = req.body.hotelName;
    if (req.body.phone)      syncFields.phone       = req.body.phone;
    if (req.body.ownerName)  syncFields.ownerName   = req.body.ownerName;
    if (Object.keys(syncFields).length > 0) {
      await Hotel.findByIdAndUpdate(req.hotelId, syncFields);
    }

    logAudit(req, 'settings.updated', 'settings', req.hotelId || '', { changedKeys: Object.keys(body).filter(k => k !== 'hotelId') });
    res.json(settings);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── POST /reset-fields — branch resets inherited fields to org defaults ────────
// A branch admin can reset selected inheritable fields to clear their local override,
// restoring inheritance from the HQ settings. Only inheritable fields are accepted.
router.post('/reset-fields', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId).select('parentHotelId features').lean();
    if (!hotel?.parentHotelId || !hotel.features?.multiBranch) {
      return res.status(403).json({ message: 'Only branch hotels in a multi-branch org can reset fields' });
    }

    const { fields } = req.body as { fields?: string[] };
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: 'fields array is required' });
    }

    const allowed = fields.filter(f => INHERITABLE_FROM_HQ.has(f));
    if (allowed.length === 0) {
      return res.status(400).json({ message: 'No valid inheritable fields specified' });
    }

    const unset: Record<string, 1> = {};
    for (const f of allowed) unset[f] = 1;

    await Settings.findOneAndUpdate(
      { hotelId: req.hotelId },
      { $unset: unset },
      { upsert: false },
    );

    logAudit(req, 'settings.reset_fields', 'settings', req.hotelId || '', { resetFields: allowed });
    return res.json({ message: 'Fields reset to organization defaults', resetFields: allowed });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── PATCH /api/settings/org-loyalty — HQ admin toggles org loyalty master switch
// Only a HQ hotel (parentHotelId: null) with multiBranch enabled can change this.
// Branch admins are rejected — they cannot override the HQ master switch (BR-2).
router.patch('/org-loyalty', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.hotelId).select('parentHotelId features').lean();
    if (!hotel) {
      res.status(404).json({ message: 'Hotel not found' });
      return;
    }
    if (hotel.parentHotelId) {
      res.status(403).json({ message: 'Only HQ admin can manage organization loyalty settings' });
      return;
    }
    if (!hotel.features?.multiBranch) {
      res.status(403).json({ message: 'Multi-branch feature is not enabled' });
      return;
    }

    const { orgLoyalty } = req.body as { orgLoyalty?: boolean };
    if (typeof orgLoyalty !== 'boolean') {
      res.status(400).json({ message: 'orgLoyalty must be a boolean' });
      return;
    }

    const updated = await Hotel.findByIdAndUpdate(
      req.hotelId,
      { $set: { 'features.orgLoyalty': orgLoyalty } },
      { new: true },
    ).select('features');

    await invalidateStatusCache(req.hotelId!);
    logAudit(req, 'settings.org_loyalty_updated', 'hotel', req.hotelId!, { orgLoyalty });

    res.json({ message: 'Organization loyalty setting updated', orgLoyalty, features: updated?.features });
  } catch (err) {
    sendError(res, 500, 'Failed to update org loyalty setting', err);
  }
});

export default router;
