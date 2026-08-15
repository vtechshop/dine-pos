import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import { logger } from '../utils/logger';

// ── Razorpay Partner-Level Webhook Handler ────────────────────────────────────
// This endpoint receives events from Razorpay for DinePOS as a Technology Partner.
// It is NOT for per-hotel payment events (those go to /api/payment-webhooks/:gateway/:hotelId).
//
// Currently handles:
//   account.app.authorization_revoked — a hotel merchant has revoked DinePOS's OAuth access.
//
// Authentication: HMAC-SHA256 signature over raw body using RAZORPAY_PARTNER_WEBHOOK_SECRET.
// No auth middleware — Razorpay calls this directly without a JWT.
// Raw body is captured by the express.json() verify hook in server.ts.

const router = Router();

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

router.post('/', async (req: Request, res: Response) => {
  const secret    = process.env.RAZORPAY_PARTNER_WEBHOOK_SECRET;
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  const rawBody   = String((req as any).rawBody ?? '');

  // ── Signature verification ─────────────────────────────────────────────────
  if (!secret) {
    logger.error('razorpayPartnerWebhook: RAZORPAY_PARTNER_WEBHOOK_SECRET not set — rejecting event');
    res.status(500).json({ message: 'Webhook secret not configured.' });
    return;
  }

  if (!verifySignature(rawBody, signature, secret)) {
    logger.warn('razorpayPartnerWebhook: signature verification failed', {
      signatureReceived: signature.slice(0, 8) + '...',
    });
    res.status(400).json({ message: 'Invalid webhook signature.' });
    return;
  }

  // ── Parse event ────────────────────────────────────────────────────────────
  let event: { event: string; account_id: string; contains: string[]; created_at: number };
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  logger.info('razorpayPartnerWebhook: received event', { event: event.event, account_id: event.account_id });

  // ── Handle account.app.authorization_revoked ───────────────────────────────
  // Fired when a hotel merchant revokes DinePOS's OAuth authorization from
  // their Razorpay Dashboard. We must immediately disable OAuth payments for that hotel.
  //
  // Processing is idempotent: if the config is already isOAuthConnected: false,
  // the updateMany matches 0 documents and returns quietly.
  //
  // We do NOT delete historical Payment records — the Payment model is unmodified.
  // We do NOT modify Hotel.features.payment — the hotel admin or super admin
  // controls that flag. We only clear the OAuth connection.
  if (event.event === 'account.app.authorization_revoked') {
    const accountId = event.account_id;
    if (!accountId) {
      logger.warn('razorpayPartnerWebhook: authorization_revoked event missing account_id');
      res.status(200).json({ received: true }); // acknowledge to avoid retries
      return;
    }

    try {
      const result = await PaymentGatewayConfig.updateMany(
        { oauthConnectedAccountId: accountId, isOAuthConnected: true },
        {
          $set: {
            isOAuthConnected:        false,
            oauthAccessTokenEnc:     '',
            oauthRefreshTokenEnc:    '',
            oauthPublicToken:        '',
            oauthConnectedAt:        null,
            oauthExpiresAt:          null,
            oauthRefreshExpiresAt:   null,
            isActive:                false,
          },
        },
      );

      if (result.modifiedCount > 0) {
        logger.info('razorpayPartnerWebhook: OAuth revoked — cleared tokens', {
          accountId,
          affectedConfigs: result.modifiedCount,
        });
      } else {
        // Already disconnected (idempotent) or unknown account_id — both are fine.
        logger.info('razorpayPartnerWebhook: authorization_revoked — no active OAuth config found (idempotent)', {
          accountId,
        });
      }
    } catch (e) {
      logger.error('razorpayPartnerWebhook: DB update failed for authorization_revoked', {
        accountId,
        err: String(e),
      });
      // Return 500 so Razorpay retries the webhook delivery.
      res.status(500).json({ message: 'Internal error processing revocation.' });
      return;
    }
  } else {
    // Unknown event type — acknowledge to prevent retries.
    logger.info('razorpayPartnerWebhook: unhandled event type (acknowledged)', { event: event.event });
  }

  // Always acknowledge with 200 for handled/unknown events.
  res.status(200).json({ received: true });
});

export default router;
