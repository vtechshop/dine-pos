import { TallySyncJob } from '../models/TallySyncJob';
import { logger } from '../utils/logger';

// Stale job recovery: jobs stuck in 'syncing' state for > STALE_THRESHOLD_MS
// are reset to 'pending'. This handles: connector crash, network drop, or process kill
// mid-poll before the connector could send an ack.
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function recoverStaleTallySyncJobs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const result = await TallySyncJob.updateMany(
      { status: 'syncing', lastAttemptAt: { $lte: cutoff } },
      { $set: { status: 'pending', nextAttemptAt: null } },
    );
    if (result.modifiedCount > 0) {
      logger.info('[tally-worker] recovered stale syncing jobs', { count: result.modifiedCount });
    }
  } catch (e) {
    logger.warn('[tally-worker] stale job recovery failed', { err: String(e) });
  }
}
