import { runHourlyAggregation } from '../workers/hourlyAggregator';
import { dispatchDailySnapshots } from '../workers/dailySnapshotBuilder';
import { dispatchMorningBriefs } from '../workers/morningBriefWorker';
import { runLoyaltyExpiry } from '../workers/loyaltyExpiryWorker';
import { dispatchScheduledCampaigns } from '../workers/campaignWorker';
import { runMenuSyncWorker } from '../workers/menuSyncWorker';
import { runRazorpayTokenRefreshWorker } from '../workers/razorpayTokenRefreshWorker';
import { logger } from '../utils/logger';

let hourlyTimer:             ReturnType<typeof setTimeout>  | null = null;
let hourlyTick:              ReturnType<typeof setInterval> | null = null;
let dailyTick:               ReturnType<typeof setInterval> | null = null;
let expiryLastDate         = -1;
let menuSyncLastRun        = 0;   // epoch ms — checked every 5 minutes
let tokenRefreshLastRun    = 0;   // epoch ms — checked every 4 hours

// ─── Hourly aggregation ───────────────────────────────────────────────────────
// Fires at :05 past every UTC hour (to let the last few stragglers land),
// then every 60 minutes thereafter.

function msUntilNextHourAt05(): number {
  const now   = new Date();
  const next  = new Date(now);
  next.setUTCMinutes(5, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

function scheduleHourly(): void {
  const delay = msUntilNextHourAt05();
  logger.info(`[scheduler] hourly aggregation starts in ${Math.round(delay / 1000)}s`);

  hourlyTimer = setTimeout(() => {
    // First fire
    void runHourlyAggregation().catch((err) =>
      logger.error('[scheduler] hourly aggregation error', { err: String(err) }),
    );
    // Then every 60 minutes
    hourlyTick = setInterval(() => {
      void runHourlyAggregation().catch((err) =>
        logger.error('[scheduler] hourly aggregation error', { err: String(err) }),
      );
    }, 60 * 60 * 1000);
  }, delay);
}

// ─── Daily snapshot + morning brief dispatch ──────────────────────────────────
// UTC 00:00–03:59 (minuteOfDay 0–239):   daily snapshot generation
// UTC 04:00–05:59 (minuteOfDay 240–359): morning brief generation
// Outside both windows the tick fires but exits immediately (near-zero cost).

function scheduleDailyDispatch(): void {
  dailyTick = setInterval(() => {
    const now         = new Date();
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const todayDate   = now.getUTCDate();

    if (minuteOfDay < 240) {
      // Daily snapshot window
      void dispatchDailySnapshots(minuteOfDay).catch((err) =>
        logger.error('[scheduler] daily snapshot error', { err: String(err) }),
      );
    } else if (minuteOfDay < 360) {
      // Morning brief window — runs after all snapshots are finalized
      void dispatchMorningBriefs(minuteOfDay).catch((err) =>
        logger.error('[scheduler] morning brief error', { err: String(err) }),
      );
    }

    // Loyalty expiry sweep — UTC 01:00 once per calendar day
    if (now.getUTCHours() === 1 && todayDate !== expiryLastDate) {
      expiryLastDate = todayDate;
      void runLoyaltyExpiry().catch((err) =>
        logger.error('[scheduler] loyalty expiry error', { err: String(err) }),
      );
    }

    // Campaign scheduling sweep — every minute, checks for campaigns past their scheduledAt
    void dispatchScheduledCampaigns().catch((err) =>
      logger.error('[scheduler] campaign dispatch error', { err: String(err) }),
    );

    // Menu sync worker — checks auto-sync integrations every 5 minutes
    const nowMs = Date.now();
    if (nowMs - menuSyncLastRun >= 5 * 60 * 1000) {
      menuSyncLastRun = nowMs;
      void runMenuSyncWorker().catch((err) =>
        logger.error('[scheduler] menu sync worker error', { err: String(err) }),
      );
    }

    // Razorpay OAuth proactive token refresh — every 4 hours.
    // Refreshes access tokens that expire within 7 days, before a live payment
    // transaction discovers the expiry mid-flow.
    if (nowMs - tokenRefreshLastRun >= 4 * 60 * 60 * 1000) {
      tokenRefreshLastRun = nowMs;
      void runRazorpayTokenRefreshWorker().catch((err) =>
        logger.error('[scheduler] razorpay token refresh error', { err: String(err) }),
      );
    }
  }, 60 * 1000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startScheduler(): void {
  if (hourlyTimer !== null || hourlyTick !== null || dailyTick !== null) {
    logger.warn('[scheduler] already running — ignoring duplicate startScheduler() call');
    return;
  }
  logger.info('[scheduler] starting');
  scheduleHourly();
  scheduleDailyDispatch();
}

export function stopScheduler(): void {
  logger.info('[scheduler] stopping');
  if (hourlyTimer) { clearTimeout(hourlyTimer);   hourlyTimer  = null; }
  if (hourlyTick)  { clearInterval(hourlyTick);   hourlyTick   = null; }
  if (dailyTick)   { clearInterval(dailyTick);    dailyTick    = null; }
  expiryLastDate = -1;
}
