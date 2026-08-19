import crypto from 'crypto';
import https from 'https';
import { Router, Response, Request } from 'express';
import mongoose from 'mongoose';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { getRedisClient } from '../config/redis';
import { encrypt } from '../utils/encryption';
import { refreshRazorpayOAuthToken, revokeRazorpayOAuthTokens } from '../services/payment/razorpayTokenRefresh';
import GatewayFactory from '../services/payment/GatewayFactory';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────
const RAZORPAY_AUTHORIZE_URL = 'https://auth.razorpay.com/authorize';
const RAZORPAY_TOKEN_URL     = 'https://auth.razorpay.com/token';
const OAUTH_STATE_TTL_SECS   = 600; // 10 minutes — time to complete the OAuth consent flow
const REFRESH_TOKEN_LIFESPAN_DAYS = 180;

// ── Helpers ───────────────────────────────────────────────────────────────────

function frontendBase(): string {
  // Derive from ALLOWED_ORIGINS (first value) so no extra env var is needed.
  // Falls back to localhost for dev.
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return origins[0] ?? 'http://localhost:5173';
}

interface RazorpayTokenResponse {
  access_token:        string;
  refresh_token:       string;
  public_token:        string;
  expires_in:          number;
  token_type:          string;
  razorpay_account_id: string;
}

function razorpayPost<T>(url: string, body: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          let json: unknown;
          try { json = JSON.parse(data); } catch { json = data; }
          if ((res.statusCode ?? 0) >= 400) {
            reject(Object.assign(
              new Error(`Razorpay token request failed — HTTP ${res.statusCode ?? '?'}`),
              { statusCode: res.statusCode, body: json },
            ));
          } else {
            resolve(json as T);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── GET /api/razorpay/oauth/connect ──────────────────────────────────────────
// Generates a Razorpay OAuth authorize URL with a CSRF-safe state token.
// The state is bound to the authenticated hotel's ID in Redis (TTL 10 min).
// The frontend must open the returned URL — do NOT redirect here (the hotel admin
// needs to remain on the frontend page to handle the post-OAuth return).
router.get('/connect', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  const clientId     = process.env.RAZORPAY_CLIENT_ID;
  const redirectUri  = process.env.RAZORPAY_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    sendError(res, 503, 'Razorpay OAuth is not configured on this server. Set RAZORPAY_CLIENT_ID and RAZORPAY_OAUTH_REDIRECT_URI.');
    return;
  }

  const redis = getRedisClient();
  if (!redis) {
    // State cannot be stored without Redis — OAuth is CSRF-unsafe without it.
    sendError(res, 503, 'OAuth connection requires Redis. Configure REDIS_URL to enable this feature.');
    return;
  }

  const state    = crypto.randomBytes(32).toString('hex');
  const hotelId  = String(req.hotelId);
  // Encode platform alongside hotelId so the callback can redirect to the
  // correct destination (web URL vs. mobile deep link) without trusting any URL parameter.
  const platform = (req.query as Record<string, string>).platform === 'mobile' ? 'mobile' : 'web';
  await redis.set(
    `razorpay_oauth_state:${state}`,
    JSON.stringify({ hotelId, platform }),
    'EX',
    OAUTH_STATE_TTL_SECS,
  );

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'read_write',
    state,
  });

  res.json({ authorizeUrl: `${RAZORPAY_AUTHORIZE_URL}?${params.toString()}` });
});

// ── GET /api/razorpay/oauth/callback ─────────────────────────────────────────
// Handles the browser redirect from Razorpay after the hotel admin approves OAuth.
// NO authMiddleware — Razorpay's browser redirect carries no Authorization header.
// Security: hotelId is derived from Redis state lookup, never from URL parameters.
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;
  // Resolve redirect targets after the state is parsed so we know the platform.
  // These are declared here only as fallbacks; the real values are set below.
  const redirectBase = frontendBase();

  // ── Validate state → retrieve hotelId + platform from Redis ─────────────
  const redis = getRedisClient();
  if (!redis) {
    res.redirect(302, `${redirectBase}/settings/payments?razorpay_error=${encodeURIComponent('Server configuration error — Redis unavailable.')}`);
    return;
  }

  const redisKey  = `razorpay_oauth_state:${state ?? ''}`;
  const rawState  = state ? await redis.get(redisKey) : null;

  // Parse JSON state; fall back gracefully to the old plain-string format
  let hotelId  = '';
  let platform = 'web';
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as { hotelId?: string; platform?: string };
      hotelId  = parsed.hotelId  ?? rawState; // backwards compat: old value was plain hotelId string
      platform = parsed.platform ?? 'web';
    } catch {
      hotelId = rawState; // legacy plain-string state
    }
  }

  // Compute redirect URLs now that we know the platform
  const successUrl = platform === 'mobile'
    ? 'dinepos://razorpay/oauth?status=connected'
    : `${redirectBase}/settings/payments?razorpay_connected=1`;
  const errorUrl = (reason: string): string => platform === 'mobile'
    ? `dinepos://razorpay/oauth?error=${encodeURIComponent(reason)}`
    : `${redirectBase}/settings/payments?razorpay_error=${encodeURIComponent(reason)}`;

  // ── Handle Razorpay-initiated errors (e.g. hotel admin cancelled consent) ──
  if (oauthError) {
    logger.warn('razorpayOAuth: callback received error from Razorpay', { error: oauthError });
    // Consume state even on error so it cannot be replayed (single-use on all paths).
    if (rawState) await redis.del(redisKey);
    res.redirect(302, errorUrl('Authorization was cancelled or denied.'));
    return;
  }

  if (!code || !state) {
    res.redirect(302, errorUrl('Invalid callback — missing code or state.'));
    return;
  }

  if (!hotelId) {
    // State expired or was never issued — possible CSRF or replay
    logger.warn('razorpayOAuth: unknown or expired OAuth state', { state: state.slice(0, 8) + '...' });
    res.redirect(302, errorUrl('Session expired — please try connecting again.'));
    return;
  }

  // Consume state immediately (single-use, prevents replay)
  await redis.del(redisKey);

  const clientId     = process.env.RAZORPAY_CLIENT_ID;
  const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
  const redirectUri  = process.env.RAZORPAY_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.redirect(302, errorUrl('Server configuration error — OAuth credentials missing.'));
    return;
  }

  // ── Exchange authorization code for tokens ────────────────────────────────
  let data: RazorpayTokenResponse;
  try {
    data = await razorpayPost<RazorpayTokenResponse>(RAZORPAY_TOKEN_URL, {
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
      code,
      mode:          process.env.NODE_ENV === 'production' ? 'live' : 'test',
    });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; body?: unknown };
    logger.error('razorpayOAuth: token exchange failed', {
      hotelId,
      statusCode: err.statusCode,
      body:       JSON.stringify(err.body ?? ''),
    });
    res.redirect(302, errorUrl('Failed to connect Razorpay account. Please try again.'));
    return;
  }

  // ── Persist encrypted tokens ──────────────────────────────────────────────
  // Upsert into PaymentGatewayConfig (one razorpay config per hotel).
  // hotelId is from Redis — NEVER from the callback URL.
  try {
    const now = new Date();
    const hotelObjId = new mongoose.Types.ObjectId(hotelId);

    await PaymentGatewayConfig.findOneAndUpdate(
      { hotelId: hotelObjId, gatewayType: 'razorpay', isDeleted: false },
      {
        $set: {
          displayName:             'Razorpay (OAuth)',
          isOAuthConnected:        true,
          oauthAccessTokenEnc:     encrypt(data.access_token),
          oauthRefreshTokenEnc:    encrypt(data.refresh_token),
          oauthPublicToken:        data.public_token,
          oauthConnectedAccountId: data.razorpay_account_id,
          oauthConnectedAt:        now,
          oauthExpiresAt:          new Date(now.getTime() + data.expires_in * 1000),
          oauthRefreshExpiresAt:   new Date(now.getTime() + REFRESH_TOKEN_LIFESPAN_DAYS * 24 * 60 * 60 * 1000),
          environment:             process.env.NODE_ENV === 'production' ? 'live' : 'sandbox',
          isActive:                true,
          isDeleted:               false,
        },
        $setOnInsert: {
          hotelId:      hotelObjId,
          gatewayType:  'razorpay',
          merchantId:   data.razorpay_account_id,
          apiKey:       '',
          apiSecretEnc: '',
          webhookSecretEnc: '',
        },
      },
      { upsert: true, new: true },
    );

    logger.info('razorpayOAuth: tokens stored', {
      hotelId,
      accountId: data.razorpay_account_id,
    });
  } catch (e) {
    logger.error('razorpayOAuth: failed to persist tokens', { hotelId, err: String(e) });
    res.redirect(302, errorUrl('Failed to save connection — please try again.'));
    return;
  }

  res.redirect(302, successUrl);
});

// ── GET /api/razorpay/oauth/status ───────────────────────────────────────────
// Returns the OAuth connection status for the authenticated hotel.
// If the access_token is near expiry, a background refresh is triggered
// so the next API call uses a fresh token.
// Never returns token values — only metadata.
router.get('/status', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({
      hotelId:   req.hotelId,
      gatewayType: 'razorpay',
      isDeleted: false,
    }).lean();

    if (!config?.isOAuthConnected) {
      res.json({ connected: false });
      return;
    }

    // Trigger a background refresh when near expiry (7 days) so the
    // current request still returns immediately without blocking.
    if (GatewayFactory.isTokenNearExpiry(config as any)) {
      const fullConfig = await PaymentGatewayConfig.findById(config._id);
      if (fullConfig) {
        void refreshRazorpayOAuthToken(fullConfig).catch((e) =>
          logger.error('razorpayOAuth: background refresh failed', { err: String(e) }),
        );
      }
    }

    res.json({
      connected:           true,
      accountId:           config.oauthConnectedAccountId,
      connectedAt:         config.oauthConnectedAt,
      expiresAt:           config.oauthExpiresAt,
      refreshExpiresAt:    config.oauthRefreshExpiresAt,
      environment:         config.environment,
      // Warn the frontend when the refresh token is close to expiry (30 days)
      // so the hotel admin knows to reconnect before losing OAuth access permanently.
      refreshTokenWarning: config.oauthRefreshExpiresAt
        ? config.oauthRefreshExpiresAt.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000
        : false,
    });
  } catch (e) {
    logger.error('razorpayOAuth: status check failed', { hotelId: req.hotelId, err: String(e) });
    sendError(res, 500, 'Failed to retrieve OAuth status.');
  }
});

// ── DELETE /api/razorpay/oauth/disconnect ─────────────────────────────────────
// Revokes the hotel's OAuth tokens with Razorpay and clears all OAuth fields
// from PaymentGatewayConfig. Historical Payment records are NOT touched.
// Idempotent — safe to call even if already disconnected.
router.delete('/disconnect', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const config = await PaymentGatewayConfig.findOne({
      hotelId:     req.hotelId,
      gatewayType: 'razorpay',
      isDeleted:   false,
    });

    if (config?.isOAuthConnected) {
      // Best-effort revocation with Razorpay (non-fatal if it fails)
      await revokeRazorpayOAuthTokens(config);
    }

    // Clear OAuth fields regardless of revocation outcome
    await PaymentGatewayConfig.updateOne(
      { hotelId: req.hotelId, gatewayType: 'razorpay', isDeleted: false },
      {
        $set: {
          isOAuthConnected:        false,
          oauthAccessTokenEnc:     '',
          oauthRefreshTokenEnc:    '',
          oauthPublicToken:        '',
          oauthConnectedAccountId: '',
          oauthConnectedAt:        null,
          oauthExpiresAt:          null,
          oauthRefreshExpiresAt:   null,
          isActive:                false,
        },
      },
    );

    logger.info('razorpayOAuth: disconnected', { hotelId: req.hotelId });
    res.json({ message: 'Razorpay account disconnected successfully.' });
  } catch (e) {
    logger.error('razorpayOAuth: disconnect failed', { hotelId: req.hotelId, err: String(e) });
    sendError(res, 500, 'Failed to disconnect Razorpay account.');
  }
});

export default router;
