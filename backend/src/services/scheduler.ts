import { runHourlyAggregation } from '../workers/hourlyAggregator';
import { dispatchDailySnapshots } from '../workers/dailySnapshotBuilder';
import { logger } from '../utils/logger';

let hourlyTimer:  ReturnType<typeof setTimeout>  | null = null;
let hourlyTick:   ReturnType<typeof setInterval> | null = null;
let dailyTick:    ReturnType<typeof setInterval> | null = null;

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

// ─── Daily snapshot dispatch ──────────────────────────────────────────────────
// Runs every UTC minute between 00:00–03:59 (minuteOfDay 0–239).
// Outside that window the tick fires but exits immediately (near-zero cost).

function scheduleDailyDispatch(): void {
  dailyTick = setInterval(() => {
    const now          = new Date();
    const minuteOfDay  = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minuteOfDay >= 240) return; // outside dispatch window

    void dispatchDailySnapshots(minuteOfDay).catch((err) =>
      logger.error('[scheduler] daily snapshot error', { err: String(err) }),
    );
  }, 60 * 1000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startScheduler(): void {
  logger.info('[scheduler] starting');
  scheduleHourly();
  scheduleDailyDispatch();
}

export function stopScheduler(): void {
  logger.info('[scheduler] stopping');
  if (hourlyTimer) { clearTimeout(hourlyTimer);   hourlyTimer = null; }
  if (hourlyTick)  { clearInterval(hourlyTick);   hourlyTick  = null; }
  if (dailyTick)   { clearInterval(dailyTick);    dailyTick   = null; }
}
