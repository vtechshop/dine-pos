import https from 'https';
import { encrypt, decrypt } from '../../utils/encryption';
import PaymentGatewayConfig, { IPaymentGatewayConfig } from '../../models/PaymentGatewayConfig';
import { logger } from '../../utils/logger';

const RAZORPAY_TOKEN_URL = 'https://auth.razorpay.com/token';
const RAZORPAY_REVOKE_URL = 'https://auth.razorpay.com/revoke';

// Refresh token lifespan: Razorpay issues a 180-day refresh_token.
// We record this in oauthRefreshExpiresAt so the UI can warn the hotel admin
// to reconnect before the refresh_token expires and OAuth access is permanently lost.
const REFRESH_TOKEN_LIFESPAN_DAYS = 180;

interface RazorpayTokenResponse {
  access_token:        string;
  refresh_token:       string;
  public_token:        string;
  expires_in:          number;   // seconds
  token_type:          string;
  razorpay_account_id: string;
}

// ── Internal HTTPS helper ──────────────────────────────────────────────────────
// No external HTTP client is used — only Node.js built-in https module.
// Sends a JSON POST and parses the response; rejects with status + body on 4xx/5xx.
function razorpayPost<T>(url: string, body: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload  = JSON.stringify(body);
    const parsed   = new URL(url);

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
            const err = Object.assign(
              new Error(`Razorpay OAuth ${url} failed — HTTP ${res.statusCode ?? '?'}`),
              { statusCode: res.statusCode, body: json },
            );
            reject(err);
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

// ── Refresh OAuth tokens ───────────────────────────────────────────────────────
// Called when the access_token is expired or near expiry.
// Razorpay rotates BOTH access_token and refresh_token on every refresh — the old
// refresh_token is invalidated immediately. We encrypt and persist both new values.
// Returns the updated config doc, or null on failure.
export async function refreshRazorpayOAuthToken(
  config: IPaymentGatewayConfig,
): Promise<IPaymentGatewayConfig | null> {
  const clientId     = process.env.RAZORPAY_CLIENT_ID;
  const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logger.error('razorpayTokenRefresh: RAZORPAY_CLIENT_ID or RAZORPAY_CLIENT_SECRET not set');
    return null;
  }
  if (!config.oauthRefreshTokenEnc) {
    logger.error('razorpayTokenRefresh: no refresh token stored', { configId: String(config._id) });
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(config.oauthRefreshTokenEnc);
  } catch (e) {
    logger.error('razorpayTokenRefresh: failed to decrypt refresh token', {
      configId: String(config._id),
      err:      String(e),
    });
    return null;
  }

  try {
    const data = await razorpayPost<RazorpayTokenResponse>(RAZORPAY_TOKEN_URL, {
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    });

    const now = new Date();
    const updated = await PaymentGatewayConfig.findByIdAndUpdate(
      config._id,
      {
        $set: {
          oauthAccessTokenEnc:   encrypt(data.access_token),
          oauthRefreshTokenEnc:  encrypt(data.refresh_token),  // new token replaces old immediately
          oauthPublicToken:      data.public_token,
          oauthExpiresAt:        new Date(now.getTime() + data.expires_in * 1000),
          oauthRefreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFESPAN_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      { new: true },
    );

    logger.info('razorpayTokenRefresh: tokens refreshed', { configId: String(config._id) });
    return updated;
  } catch (e: unknown) {
    const err = e as { statusCode?: number; body?: unknown };
    logger.error('razorpayTokenRefresh: refresh request failed', {
      configId:   String(config._id),
      statusCode: err.statusCode,
      body:       JSON.stringify(err.body ?? ''),
    });
    return null;
  }
}

// ── Revoke OAuth tokens with Razorpay ─────────────────────────────────────────
// Called on disconnect. Revokes both the access_token and refresh_token so
// Razorpay also cleans up on their side. Non-fatal — we clear DB fields regardless.
export async function revokeRazorpayOAuthTokens(
  config: IPaymentGatewayConfig,
): Promise<void> {
  const clientId     = process.env.RAZORPAY_CLIENT_ID;
  const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  const revoke = async (tokenEnc: string, tokenTypeHint: 'access_token' | 'refresh_token') => {
    if (!tokenEnc) return;
    let token: string;
    try { token = decrypt(tokenEnc); } catch { return; }
    try {
      await razorpayPost(RAZORPAY_REVOKE_URL, {
        client_id:       clientId,
        client_secret:   clientSecret,
        token_type_hint: tokenTypeHint,
        token,
      });
    } catch (e) {
      // Non-fatal — log and continue; DB fields are cleared regardless.
      logger.warn('razorpayTokenRefresh: revoke call failed (non-fatal)', {
        tokenTypeHint,
        configId: String(config._id),
        err:      String(e),
      });
    }
  };

  await Promise.all([
    revoke(config.oauthAccessTokenEnc,  'access_token'),
    revoke(config.oauthRefreshTokenEnc, 'refresh_token'),
  ]);
}

// ── Ensure valid OAuth token before gateway use ────────────────────────────────
// Call before GatewayFactory.create() when config.isOAuthConnected is true.
// Returns config unchanged if token is still valid, or the refreshed config if expired.
// Throws if the token is expired and refresh fails — caller should surface this to the user.
export async function ensureValidOAuthConfig(
  config: IPaymentGatewayConfig,
): Promise<IPaymentGatewayConfig> {
  if (!config.isOAuthConnected) return config;
  if (config.oauthExpiresAt && config.oauthExpiresAt > new Date()) return config;

  logger.info('razorpayTokenRefresh: access_token expired, refreshing before use', {
    configId: String(config._id),
  });

  const updated = await refreshRazorpayOAuthToken(config);
  if (!updated) {
    throw new Error(
      'Razorpay OAuth access token expired and refresh failed. ' +
      'Please reconnect via Payment Settings → Gateways.',
    );
  }
  return updated;
}
