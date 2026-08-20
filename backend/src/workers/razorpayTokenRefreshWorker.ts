import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import { refreshRazorpayOAuthToken } from '../services/payment/razorpayTokenRefresh';
import { acquireSchedulerLock, releaseSchedulerLock } from '../utils/schedulerLock';
import { logger } from '../utils/logger';

// In-memory guard — prevents a second sweep from overlapping the first in the
// same process.  Not needed for correctness (each findByIdAndUpdate is atomic),
// but avoids hammering Razorpay with concurrent refresh calls when many hotels
// have tokens expiring at the same time.
let sweepInProgress = false;

// Proactive OAuth token refresh sweep.
// Called every 4 hours by the scheduler.
//
// Finds every PaymentGatewayConfig where:
//   • isOAuthConnected is true
//   • the access_token expires within the next 7 days (or has already expired)
//   • the refresh_token is still valid and present
//
// For each, calls refreshRazorpayOAuthToken() which:
//   • decrypts the refresh_token in backend memory only
//   • exchanges it at POST https://auth.razorpay.com/token
//   • encrypts and atomically persists both new tokens
//   • never logs or returns token values
//
// Assumptions that require real Razorpay sandbox validation before marking
// production-ready:
//   • Razorpay genuinely rotates both access_token and refresh_token on every
//     refresh call (documented but not yet tested with real credentials).
//   • The `expires_in` field returned by the refresh response is in seconds
//     (same as the initial authorization_code exchange — assumed consistent).
//   • Razorpay does not rate-limit proactive refresh calls when the token is
//     not yet expired (the sweep only runs every 4 h, so at most one call per
//     hotel per 4 h during the 7-day window — low volume).
//
// Items still requiring Technology Partner approval:
//   • Production RAZORPAY_CLIENT_ID / RAZORPAY_CLIENT_SECRET
//   • Confirmation that the refresh endpoint is available in sandbox mode
export async function runRazorpayTokenRefreshWorker(): Promise<void> {
  if (sweepInProgress) return;  // previous sweep still running — skip this tick

  const clientId     = process.env.RAZORPAY_CLIENT_ID;
  const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // OAuth not yet configured — skip silently.  This is expected until the
    // Razorpay Technology Partner application is approved and credentials are set.
    return;
  }

  sweepInProgress = true;
  try {
    const now              = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const configs = await PaymentGatewayConfig.find({
      isOAuthConnected:     true,
      isDeleted:            false,
      oauthRefreshTokenEnc: { $nin: ['', null] },   // must have a refresh token
      oauthExpiresAt:       { $lte: sevenDaysFromNow }, // access token near expiry or already expired
      $or: [
        { oauthRefreshExpiresAt: { $gt: now } }, // refresh token still valid
        { oauthRefreshExpiresAt: null },          // no expiry recorded — optimistically try
      ],
    });

    if (configs.length === 0) return;

    logger.info(`[razorpayTokenRefreshWorker] ${configs.length} token(s) need proactive refresh`);

    for (const config of configs) {
      // Per-hotel distributed lock — prevents two instances from refreshing the same
      // hotel's tokens simultaneously. Razorpay rotates BOTH tokens on each refresh
      // call; a concurrent second refresh sends an already-consumed refresh_token and
      // Razorpay rejects it, taking that hotel's gateway offline.
      const lockName = `razorpay-token-refresh:${config._id.toString()}`;
      const acquired = await acquireSchedulerLock(lockName, 300); // 5-minute TTL
      if (!acquired) {
        logger.info('[razorpayTokenRefreshWorker] lock held by another instance, skipping', {
          configId: String(config._id),
          hotelId:  String(config.hotelId),
        });
        continue;
      }
      try {
        const updated = await refreshRazorpayOAuthToken(config);
        if (updated) {
          logger.info('[razorpayTokenRefreshWorker] token refreshed', {
            configId: String(config._id),
            hotelId:  String(config.hotelId),
          });
        } else {
          // refreshRazorpayOAuthToken already logged the failure reason.
          logger.warn('[razorpayTokenRefreshWorker] refresh returned null — hotel may need to reconnect', {
            configId: String(config._id),
            hotelId:  String(config.hotelId),
          });
        }
      } catch (err) {
        // Individual failure must not abort the sweep for remaining hotels.
        logger.error('[razorpayTokenRefreshWorker] unexpected error during refresh', {
          configId: String(config._id),
          hotelId:  String(config.hotelId),
          err:      String(err),
        });
      } finally {
        await releaseSchedulerLock(lockName);
      }
    }
  } finally {
    sweepInProgress = false;
  }
}
