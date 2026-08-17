/**
 * Messaging Webhook Routes
 * Mount point: /api/messaging-webhooks
 *
 * Receives per-message delivery status updates from MSG91.
 * NO authentication middleware — webhook endpoints are public but
 * authenticated by a pre-shared custom header (x-dinepos-secret).
 *
 * URL pattern: POST /api/messaging-webhooks/:provider/:hotelId
 *   - :provider  = 'msg91' (future: 'waba', 'twilio')
 *   - :hotelId   = hotel's MongoDB ObjectId
 *
 * Hotel operators paste this URL into their MSG91 dashboard → Webhooks, and
 * configure the custom header x-dinepos-secret with the value from Settings → Integrations.
 *
 * Security invariants:
 *  - hotelId from URL param, not from event body — cannot be spoofed
 *  - Pre-shared header compared before any DB write
 *  - CampaignMessage lookup includes hotelId — prevents cross-tenant mutation
 *  - Duplicate events are idempotent (findOneAndUpdate with status guard)
 *  - Always responds 200 to prevent provider retry storms
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { decrypt } from '../utils/encryption';
import MessagingProviderConfig from '../models/MessagingProviderConfig';
import CampaignMessage         from '../models/CampaignMessage';
import { logger }              from '../utils/logger';

const router = Router();

// ── POST /api/messaging-webhooks/:provider/:hotelId ───────────────────────────

router.post('/:provider/:hotelId', async (req: Request, res: Response): Promise<void> => {
  const { provider, hotelId } = req.params;

  // 1. Validate hotelId is a valid ObjectId
  if (!mongoose.isValidObjectId(hotelId)) {
    // Return 200 — prevents retry storms for bad URLs
    res.status(200).json({ received: true });
    return;
  }

  const hotelObjId = new mongoose.Types.ObjectId(hotelId);

  try {
    // 2. Load the hotel's provider config (validates that hotel + provider exist)
    const cfg = await MessagingProviderConfig.findOne({
      hotelId:      hotelObjId,
      providerType: provider,
      isActive:     true,
      isDeleted:    false,
    }).lean();

    if (!cfg) {
      // Unknown hotel or provider — silently ack, not an error
      res.status(200).json({ received: true });
      return;
    }

    // 3. Verify pre-shared header — always required (A1: no bypass when secret not configured)
    if (!cfg.webhookSecretEnc) {
      logger.warn('[messaging-webhook] Rejected — no webhook secret configured', { hotelId, provider });
      res.status(200).json({ received: true }); // 200 prevents MSG91 retry storms
      return;
    }
    const storedSecret = decrypt(cfg.webhookSecretEnc);
    const headerSecret = String(req.headers['x-dinepos-secret'] ?? '');
    if (headerSecret !== storedSecret) {
      logger.warn('[messaging-webhook] Invalid secret header', { hotelId, provider });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 4. Parse event
    const body = req.body as Record<string, any>;
    await _processEvent(hotelObjId, provider, body);

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error('[messaging-webhook] Handler error', { hotelId, provider, err: String(err) });
    // Still 200 to prevent MSG91 retrying indefinitely
    res.status(200).json({ received: true, error: 'Internal error' });
  }
});

// ── Event processor ───────────────────────────────────────────────────────────

async function _processEvent(
  hotelObjId: mongoose.Types.ObjectId,
  provider:   string,
  body:       Record<string, any>,
): Promise<void> {
  // MSG91 WhatsApp webhook fields:
  //   requestId      — batch-level request ID (matches send API response)
  //   customerNumber — recipient phone
  //   uuid           — per-message WAMID (not available at send time)
  //   eventName      — 'sent' | 'delivered' | 'read' | 'failed'
  //   reason         — error string for 'failed' events
  //   ts             — ISO timestamp

  // MSG91 SMS webhook fields:
  //   requestId  — batch-level request ID
  //   telNum     — recipient phone
  //   UUID       — per-message ID
  //   eventName  — 'delivered' | 'failed'
  //   failureReason

  const requestId = String(body.requestId ?? body.CRQID ?? '');
  const phone     = String(body.customerNumber ?? body.telNum ?? '');
  const uuid      = String(body.uuid ?? body.UUID ?? '');
  const eventName = String(body.eventName ?? body.event ?? '').toLowerCase();

  if (!requestId || !phone || !eventName) {
    logger.warn('[messaging-webhook] Incomplete payload', { requestId, phone, eventName });
    return;
  }

  // Forward-only status rank: queued(0) < sent(1) = failed(1) < delivered(2) < read(3)
  // failed shares rank with sent so it cannot overwrite delivered or read
  const STATUS_RANK: Record<string, number> = {
    queued: 0, sent: 1, failed: 1, delivered: 2, read: 3,
  };
  const statusMap: Record<string, string> = {
    sent:      'sent',
    delivered: 'delivered',
    read:      'read',
    failed:    'failed',
  };

  const newStatus = statusMap[eventName];
  if (!newStatus) {
    // Unknown event type — skip silently
    return;
  }

  const now = new Date();
  const setFields: Record<string, any> = { status: newStatus };
  if (uuid)                      setFields.providerMessageId = uuid;
  if (newStatus === 'sent')      setFields.sentAt      = now;
  if (newStatus === 'delivered') setFields.deliveredAt = now;
  if (newStatus === 'read')      setFields.readAt      = now;
  if (newStatus === 'failed') {
    setFields.failedAt      = now;
    setFields.failureReason = String(body.reason ?? body.failureReason ?? '').slice(0, 300);
  }

  // Idempotent, forward-only update: only advance status, never regress.
  // Any status with a higher rank than newStatus must not be overwritten.
  const newRank = STATUS_RANK[newStatus] ?? 0;
  const doNotOverwrite = Object.keys(STATUS_RANK).filter(s => (STATUS_RANK[s] ?? 0) > newRank);

  const result = await CampaignMessage.findOneAndUpdate(
    {
      requestId,
      phone,
      hotelId: hotelObjId,   // hotel isolation — prevents cross-tenant updates
      ...(doNotOverwrite.length > 0 ? { status: { $nin: doNotOverwrite } } : {}),
    },
    { $set: setFields },
    { new: false },
  );

  if (!result) {
    // Either not found or already in a terminal state — both are fine
    return;
  }

  logger.info('[messaging-webhook] Status updated', {
    hotelId:    hotelObjId.toString(),
    campaignId: String(result.campaignId),
    phone,
    newStatus,
    requestId,
  });
}

export default router;
