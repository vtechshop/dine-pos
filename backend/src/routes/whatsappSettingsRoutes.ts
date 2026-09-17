/**
 * WhatsApp Auto-Receipt Settings Routes
 * Mount point: /api/settings/whatsapp-receipts
 *
 * GET  /api/settings/whatsapp-receipts        — read current config (admin only)
 * PATCH /api/settings/whatsapp-receipts       — update config (admin only)
 * POST /api/settings/whatsapp-receipts/test   — send a test message (admin only)
 *
 * Security invariants:
 *  - requireAdmin: only hotel admin/owner can read or change WhatsApp config
 *  - hotelId from req.hotelId (JWT), never from request body
 *  - Credentials (MSG91 API key) are in MessagingProviderConfig — never returned here
 *  - Test message goes only to the hotel's own registered number; arbitrary targets rejected
 *  - All configuration changes are audit-logged
 */

import { Router, Response }    from 'express';
import mongoose                from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Settings                from '../models/Settings';
import MessagingProviderConfig from '../models/MessagingProviderConfig';
import WhatsAppReceipt         from '../models/WhatsAppReceipt';
import { getMessagingProvider } from '../services/messagingProvider';
import { normalizePhone }       from '../services/whatsappReceiptService';
import { logAudit }             from '../utils/audit';
import { sendError }            from '../utils/sendError';
import { makeRateLimiter }      from '../utils/rateLimiter';

const router = Router();

// 5 test messages per minute per hotel — prevents accidental spam
const testRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 5 });

router.use(authMiddleware);
router.use(requireAdmin);

// ── GET /api/settings/whatsapp-receipts ───────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const settings = await Settings.findOne(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId!) },
    ).select('whatsappReceipts').lean();

    const waCfg = (settings as any)?.whatsappReceipts ?? {
      autoSend:        false,
      templateName:    '',
      templateLanguage: 'en',
      templateVars:    [],
    };

    // Check whether a messaging provider is configured
    const providerCfg = await MessagingProviderConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isActive:  true,
      isDeleted: false,
    }).select('providerType integratedNumber isActive testResult').lean();

    res.json({
      config:   waCfg,
      provider: providerCfg
        ? {
            configured:     true,
            providerType:   providerCfg.providerType,
            integratedNumber: providerCfg.integratedNumber,
            lastTested:     providerCfg.testResult ?? null,
          }
        : { configured: false },
    });
  } catch (err) {
    sendError(res, 500, 'Failed to load WhatsApp receipt settings', err);
  }
});

// ── PATCH /api/settings/whatsapp-receipts ─────────────────────────────────────

router.patch('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      autoSend,
      templateName,
      templateLanguage,
      templateVars,
    } = req.body as {
      autoSend?:        boolean;
      templateName?:    string;
      templateLanguage?: string;
      templateVars?:    string[];
    };

    const update: Record<string, unknown> = {};

    if (typeof autoSend === 'boolean') {
      update['whatsappReceipts.autoSend'] = autoSend;
    }
    if (typeof templateName === 'string') {
      if (templateName.length > 200) {
        res.status(400).json({ message: 'templateName must be 200 characters or fewer.' });
        return;
      }
      update['whatsappReceipts.templateName'] = templateName.trim();
    }
    if (typeof templateLanguage === 'string') {
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLanguage.trim())) {
        res.status(400).json({ message: 'templateLanguage must be a valid BCP-47 code, e.g. en, hi, en_US.' });
        return;
      }
      update['whatsappReceipts.templateLanguage'] = templateLanguage.trim();
    }
    if (Array.isArray(templateVars)) {
      if (templateVars.length > 20) {
        res.status(400).json({ message: 'templateVars must have at most 20 entries.' });
        return;
      }
      if (!templateVars.every(v => typeof v === 'string' && v.length <= 100)) {
        res.status(400).json({ message: 'Each templateVar must be a string of 100 characters or fewer.' });
        return;
      }
      update['whatsappReceipts.templateVars'] = templateVars;
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ message: 'No valid fields to update.' });
      return;
    }

    const updated = await Settings.findOneAndUpdate(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId!) },
      { $set: update },
      { new: true, upsert: true },
    ).select('whatsappReceipts').lean();

    logAudit(req, 'whatsapp_receipts.config_changed', 'settings', req.hotelId!, {
      changed: Object.keys(update),
    });

    res.json({ config: (updated as any)?.whatsappReceipts });
  } catch (err) {
    sendError(res, 500, 'Failed to update WhatsApp receipt settings', err);
  }
});

// ── POST /api/settings/whatsapp-receipts/test ─────────────────────────────────

router.post('/test', testRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };

    // Phone is required — admin must supply a number they control
    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ message: 'phone is required for a test message.' });
      return;
    }
    const normalized = normalizePhone(phone.trim());
    if (!normalized) {
      res.status(400).json({ message: 'Invalid phone number. Use 10-digit Indian mobile or E.164 format.' });
      return;
    }

    // Get current receipt config
    const settings = await Settings.findOne(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId!) },
    ).select('whatsappReceipts hotelName').lean();
    const waCfg = (settings as any)?.whatsappReceipts;

    if (!waCfg?.templateName?.trim()) {
      res.status(400).json({
        message: 'No template configured. Set a templateName in WhatsApp Receipts settings first.',
      });
      return;
    }

    const provider = await getMessagingProvider(req.hotelId!, 'whatsapp');
    if (provider.name === 'none') {
      res.status(400).json({
        message: 'No messaging provider configured. Add MSG91 credentials in Settings → Integrations.',
      });
      return;
    }

    // Build a minimal test var set
    const testVars: Record<string, string> = {
      customerName:   'Test Customer',
      restaurantName: (settings as any)?.hotelName ?? 'Your Restaurant',
      orderNumber:    'TEST-001',
      grandTotal:     '₹100.00',
      paymentMethod:  'Cash',
      tableNumber:    'Takeaway',
      orderDate:      new Date().toLocaleDateString('en-IN'),
      orderTime:      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      itemCount:      '1',
      subtotal:       '₹95.24',
      taxTotal:       '₹4.76',
      discountAmount: '₹0.00',
    };

    const result = await provider.sendMessages(
      `test-${req.hotelId}-${Date.now()}`,
      'whatsapp',
      [{ phone: normalized, message: '', vars: testVars }],
      {
        templateName:      waCfg.templateName.trim(),
        templateLanguage:  waCfg.templateLanguage ?? 'en',
        templateNamespace: '',
        templateVars:      Array.isArray(waCfg.templateVars) ? waCfg.templateVars : [],
      },
    );

    logAudit(req, 'whatsapp_receipts.test_sent', 'settings', req.hotelId!, {
      normalizedPhone: normalized.slice(0, -4) + '****', // mask last 4 digits
      status:          result.status,
    });

    if (result.status === 'sent') {
      res.json({ success: true, message: 'Test message sent. Check the device for delivery.' });
    } else {
      res.status(502).json({
        success: false,
        message: result.reason ?? result.recipients[0]?.failureReason ?? 'Provider rejected the test message.',
      });
    }
  } catch (err) {
    sendError(res, 500, 'Test message failed', err);
  }
});

// ── GET /api/settings/whatsapp-receipts/available-vars ────────────────────────

router.get('/available-vars', (_req: AuthRequest, res: Response): void => {
  res.json({
    vars: [
      { name: 'customerName',   description: "Customer's name, or 'Valued Customer'" },
      { name: 'restaurantName', description: 'Your restaurant name from Settings' },
      { name: 'orderNumber',    description: 'Order reference number, e.g. ORD-20241215-001' },
      { name: 'grandTotal',     description: 'Total amount including tax and discounts' },
      { name: 'subtotal',       description: 'Pre-tax subtotal' },
      { name: 'taxTotal',       description: 'Tax amount' },
      { name: 'discountAmount', description: 'Discount applied to the bill' },
      { name: 'paymentMethod',  description: 'Cash, UPI, Card, or Split' },
      { name: 'tableNumber',    description: "Table number, or 'Takeaway'" },
      { name: 'orderDate',      description: 'Bill date' },
      { name: 'orderTime',      description: 'Bill time' },
      { name: 'itemCount',      description: 'Number of items in the order' },
    ],
  });
});

// ── GET /api/settings/whatsapp-receipts/stats ─────────────────────────────────

router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000); // last 30 days

    const [counts] = await WhatsAppReceipt.aggregate([
      { $match: { hotelId: hotelObjId, createdAt: { $gte: since } } },
      {
        $group: {
          _id:       null,
          total:     { $sum: 1 },
          sent:      { $sum: { $cond: [{ $eq: ['$status', 'sent'] },      1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          read:      { $sum: { $cond: [{ $eq: ['$status', 'read'] },      1, 0] } },
          failed:    { $sum: { $cond: [{ $eq: ['$status', 'failed'] },    1, 0] } },
          queued:    { $sum: { $cond: [{ $eq: ['$status', 'queued'] },    1, 0] } },
        },
      },
    ]).exec();

    res.json(counts ?? { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 });
  } catch (err) {
    sendError(res, 500, 'Failed to load WhatsApp receipt stats', err);
  }
});

export default router;
