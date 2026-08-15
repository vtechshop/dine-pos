import { Router, Response } from 'express';
import mongoose from 'mongoose';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';
import { encrypt } from '../utils/encryption';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const REDACTED = '[REDACTED]';

function safeConfig(c: InstanceType<typeof PaymentGatewayConfig>) {
  const obj = c.toObject();
  return {
    ...obj,
    // Encrypted credential fields — never expose ciphertext to the frontend
    apiSecretEnc:          obj.apiSecretEnc          ? REDACTED : '',
    webhookSecretEnc:      obj.webhookSecretEnc      ? REDACTED : '',
    oauthAccessTokenEnc:   obj.oauthAccessTokenEnc   ? REDACTED : '',
    oauthRefreshTokenEnc:  obj.oauthRefreshTokenEnc  ? REDACTED : '',
    isIntegrated:          GatewayFactory.isRegistered(obj.gatewayType),
  };
}

// ── GET /api/payment-gateway-configs ─────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const configs = await PaymentGatewayConfig.find({ hotelId: req.hotelId, isDeleted: false }).sort({ createdAt: 1 });
    return res.json(configs.map(safeConfig));
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch gateway configs', err);
  }
});

// ── POST /api/payment-gateway-configs ─────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { gatewayType, displayName, merchantId, apiKey, apiSecret, webhookSecret, environment } = req.body as {
      gatewayType: string; displayName: string; merchantId?: string;
      apiKey?: string; apiSecret?: string; webhookSecret?: string; environment?: string;
    };

    if (!gatewayType || !displayName) {
      return res.status(400).json({ message: 'gatewayType and displayName are required' });
    }

    const supported = GatewayFactory.getSupportedTypes() as string[];
    if (!supported.includes(gatewayType)) {
      return res.status(400).json({ message: `Unsupported gateway type. Supported: ${supported.join(', ')}` });
    }

    const existing = await PaymentGatewayConfig.findOne({ hotelId: req.hotelId, gatewayType, isDeleted: false });
    if (existing) {
      return res.status(409).json({ message: `A configuration for '${gatewayType}' already exists. Use PUT to update it.` });
    }

    const config = await PaymentGatewayConfig.create({
      hotelId:         new mongoose.Types.ObjectId(req.hotelId),
      gatewayType,
      displayName:     displayName.trim(),
      merchantId:      merchantId?.trim() ?? '',
      apiKey:          apiKey?.trim() ?? '',
      apiSecretEnc:    apiSecret      ? encrypt(apiSecret)      : '',
      webhookSecretEnc: webhookSecret ? encrypt(webhookSecret)  : '',
      environment:     environment === 'live' ? 'live' : 'sandbox',
    });

    logAudit(req, 'payment_gateway_config_created', 'PaymentGatewayConfig', String(config._id), { gatewayType, environment });
    return res.status(201).json(safeConfig(config));
  } catch (err) {
    return sendError(res, 500, 'Failed to create gateway config', err);
  }
});

// ── PUT /api/payment-gateway-configs/:id ──────────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!config) return res.status(404).json({ message: 'Gateway config not found' });

    const { displayName, merchantId, apiKey, apiSecret, webhookSecret, environment } = req.body as {
      displayName?: string; merchantId?: string; apiKey?: string;
      apiSecret?: string; webhookSecret?: string; environment?: string;
    };

    if (displayName !== undefined) config.displayName = displayName.trim();
    if (merchantId  !== undefined) config.merchantId  = merchantId.trim();
    if (apiKey      !== undefined) config.apiKey       = apiKey.trim();
    if (environment !== undefined) config.environment  = environment === 'live' ? 'live' : 'sandbox';

    // Only update encrypted secrets if a new value was provided (not the redacted placeholder)
    if (apiSecret     && apiSecret     !== REDACTED) config.apiSecretEnc      = encrypt(apiSecret);
    if (webhookSecret && webhookSecret !== REDACTED) config.webhookSecretEnc  = encrypt(webhookSecret);

    await config.save();
    logAudit(req, 'payment_gateway_config_updated', 'PaymentGatewayConfig', String(config._id), { gatewayType: config.gatewayType });
    return res.json(safeConfig(config));
  } catch (err) {
    return sendError(res, 500, 'Failed to update gateway config', err);
  }
});

// ── DELETE /api/payment-gateway-configs/:id ───────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!config) return res.status(404).json({ message: 'Gateway config not found' });

    config.isActive  = false;
    config.isDeleted = true;
    await config.save();

    logAudit(req, 'payment_gateway_config_deleted', 'PaymentGatewayConfig', String(config._id), { gatewayType: config.gatewayType });
    return res.json({ message: 'Gateway config deleted' });
  } catch (err) {
    return sendError(res, 500, 'Failed to delete gateway config', err);
  }
});

// ── PATCH /api/payment-gateway-configs/:id/toggle ────────────────────────────

router.patch('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!config) return res.status(404).json({ message: 'Gateway config not found' });

    // Deactivate all other configs when activating one (only one active at a time)
    if (!config.isActive) {
      await PaymentGatewayConfig.updateMany(
        { hotelId: req.hotelId, isDeleted: false, _id: { $ne: config._id } },
        { $set: { isActive: false } },
      );
    }

    config.isActive = !config.isActive;
    await config.save();

    logAudit(req, config.isActive ? 'payment_gateway_enabled' : 'payment_gateway_disabled', 'PaymentGatewayConfig', String(config._id), { gatewayType: config.gatewayType });
    return res.json(safeConfig(config));
  } catch (err) {
    return sendError(res, 500, 'Failed to toggle gateway', err);
  }
});

// ── POST /api/payment-gateway-configs/:id/test ───────────────────────────────

router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!config) return res.status(404).json({ message: 'Gateway config not found' });

    let result: { success: boolean; message: string };

    if (!GatewayFactory.isRegistered(config.gatewayType)) {
      result = {
        success: false,
        message: `Gateway '${config.gatewayType}' SDK is not yet integrated. Register the SDK implementation via GatewayFactory.register() to enable live testing.`,
      };
    } else {
      try {
        const gateway = GatewayFactory.create(config);
        result = await gateway.testConnection();
      } catch (e) {
        result = { success: false, message: (e as Error).message };
      }
    }

    // Persist last test result
    config.testResult = { lastTestedAt: new Date(), success: result.success, message: result.message };
    await config.save();

    logAudit(req, 'payment_gateway_tested', 'PaymentGatewayConfig', String(config._id), { gatewayType: config.gatewayType, success: result.success });
    return res.json(result);
  } catch (err) {
    return sendError(res, 500, 'Test connection failed', err);
  }
});

export default router;
