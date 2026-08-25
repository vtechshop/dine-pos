import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import Settings from '../models/Settings';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
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

// GET settings for this hotel — includes premium status from Hotel record
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Run both queries in parallel — they have no data dependency
    const [settingsDoc, hotel] = await Promise.all([
      Settings.findOne({ hotelId: req.hotelId }),
      Hotel.findById(req.hotelId).select('isPremium premiumPlan premiumExpiry trialEndsAt features'),
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

    const payload: Record<string, any> = {
      ...settings!.toObject(),
      isPremium: isPremiumActive || isTrialActive || false,
      premiumPlan: hotel?.premiumPlan || 'free',
      premiumExpiry: hotel?.premiumExpiry || null,
      trialEndsAt: hotel?.trialEndsAt || null,
      features: hotel?.features ?? {},
      qrAppUrl: process.env.QR_APP_URL || 'https://dine-pos-qr-rho.vercel.app',
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

export default router;
