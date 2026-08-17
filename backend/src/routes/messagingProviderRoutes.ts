/**
 * Messaging Provider Routes
 * Mount point: /api/messaging-providers
 *
 * Manages per-hotel MSG91 credentials for WhatsApp/SMS campaign delivery.
 * All routes require authMiddleware + requireAdmin.
 *
 * Security invariants:
 *  - hotelId always sourced from JWT (req.hotelId), never from request body
 *  - apiKeyEnc and webhookSecretEnc NEVER returned in responses
 *  - hasApiKey / hasWebhookSecret booleans returned instead
 *  - Credentials encrypted at rest via AES-256-GCM (PAYMENT_ENCRYPTION_KEY)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { encrypt, decrypt } from '../utils/encryption';
import MessagingProviderConfig from '../models/MessagingProviderConfig';
import type { MessagingChannel, MessagingProviderType } from '../models/MessagingProviderConfig';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const VALID_PROVIDER_TYPES: MessagingProviderType[] = ['msg91'];
const VALID_CHANNELS: MessagingChannel[]            = ['whatsapp', 'sms', 'both'];

function safeConfig(doc: InstanceType<typeof MessagingProviderConfig>) {
  const obj = doc.toObject();
  return {
    ...obj,
    apiKeyEnc:        undefined,   // never expose
    webhookSecretEnc: undefined,   // never expose
    hasApiKey:        !!obj.apiKeyEnc,
    hasWebhookSecret: !!obj.webhookSecretEnc,
  };
}

// ── GET /api/messaging-providers — hotel's current config ─────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = await MessagingProviderConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isDeleted: false,
    });
    res.json({ config: cfg ? safeConfig(cfg) : null });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch messaging provider config', err);
  }
});

// ── POST /api/messaging-providers — create or replace config ─────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      providerType, channel, apiKey, integratedNumber,
      senderId, waNamespace, webhookSecret,
    } = req.body as {
      providerType:      string;
      channel:           string;
      apiKey?:           string;
      integratedNumber?: string;
      senderId?:         string;
      waNamespace?:      string;
      webhookSecret?:    string;
    };

    if (!VALID_PROVIDER_TYPES.includes(providerType as MessagingProviderType)) {
      res.status(400).json({ message: `providerType must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` }); return;
    }
    if (!VALID_CHANNELS.includes(channel as MessagingChannel)) {
      res.status(400).json({ message: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }); return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);

    // Upsert — one config per hotel (soft-deleted records are replaced)
    const existing = await MessagingProviderConfig.findOne({
      hotelId: hotelObjId, isDeleted: false,
    });

    const update: Record<string, any> = {
      providerType: providerType as MessagingProviderType,
      channel:      channel as MessagingChannel,
      isActive:     true,
    };

    if (integratedNumber !== undefined) update.integratedNumber = String(integratedNumber).trim().slice(0, 20);
    if (senderId         !== undefined) update.senderId         = String(senderId).trim().slice(0, 20);
    if (waNamespace      !== undefined) update.waNamespace      = String(waNamespace).trim().slice(0, 200);

    if (apiKey?.trim())       update.apiKeyEnc        = encrypt(apiKey.trim());
    if (webhookSecret?.trim()) update.webhookSecretEnc = encrypt(webhookSecret.trim());

    let cfg: InstanceType<typeof MessagingProviderConfig>;

    if (existing) {
      Object.assign(existing, update);
      cfg = await existing.save();
    } else {
      cfg = await MessagingProviderConfig.create({ hotelId: hotelObjId, ...update });
    }

    res.status(existing ? 200 : 201).json({ config: safeConfig(cfg) });
  } catch (err) {
    sendError(res, 500, 'Failed to save messaging provider config', err);
  }
});

// ── POST /api/messaging-providers/:id/test — verify credentials ───────────────

router.post('/:id/test', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = await MessagingProviderConfig.findOne({
      _id:       new mongoose.Types.ObjectId(req.params.id),
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isDeleted: false,
    });

    if (!cfg) { res.status(404).json({ message: 'Config not found' }); return; }
    if (!cfg.apiKeyEnc) { res.status(400).json({ success: false, message: 'No API key saved — save credentials first' }); return; }

    let success  = false;
    let message  = '';

    try {
      const apiKey = decrypt(cfg.apiKeyEnc);

      // MSG91 balance/account check endpoint — verifies authkey without sending a message
      const response = await fetch('https://api.msg91.com/api/balance.php', {
        headers: { authkey: apiKey },
      });

      if (response.ok) {
        const text = await response.text();
        // MSG91 returns "Error" in body text on bad key, or a numeric balance
        if (text.trim().toLowerCase().startsWith('error')) {
          success = false;
          message = `MSG91 rejected the API key: ${text.trim().slice(0, 100)}`;
        } else {
          success = true;
          message = 'Credentials verified successfully.';
        }
      } else {
        success = false;
        message = `MSG91 responded with status ${response.status}`;
      }
    } catch (err) {
      success = false;
      message = `Connection failed: ${String(err).slice(0, 200)}`;
    }

    // Persist test result
    cfg.testResult = { lastTestedAt: new Date(), success, message };
    await cfg.save();

    res.json({ success, message });
  } catch (err) {
    sendError(res, 500, 'Test failed', err);
  }
});

// ── DELETE /api/messaging-providers/:id — soft-delete ────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = await MessagingProviderConfig.findOne({
      _id:       new mongoose.Types.ObjectId(req.params.id),
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isDeleted: false,
    });

    if (!cfg) { res.status(404).json({ message: 'Config not found' }); return; }

    cfg.isDeleted = true;
    cfg.isActive  = false;
    await cfg.save();

    res.json({ message: 'Messaging provider disconnected' });
  } catch (err) {
    sendError(res, 500, 'Failed to disconnect messaging provider', err);
  }
});

export default router;
