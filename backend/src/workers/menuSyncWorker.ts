import AggregatorIntegration from '../models/AggregatorIntegration';
import Product from '../models/Product';
import Category from '../models/Category';
import { AggregatorService } from '../services/aggregator/AggregatorService';
import type { AggregatorPlatform } from '../models/AggregatorIntegration';
import { logger } from '../utils/logger';

export async function runMenuSyncWorker(): Promise<void> {
  const now = new Date();

  // E-F07: Treat a 'syncing' lock as stale if it was set more than 15 minutes ago.
  // This recovers from a crashed/hung sync worker that never cleared the lease.
  const staleBefore = new Date(now.getTime() - 15 * 60_000);
  const due = await AggregatorIntegration.find({
    enabled:         true,
    autoSyncEnabled: true,
    // Skip only integrations with a FRESH sync lock (started within the last 15 min).
    // A stale lock (syncingStartedAt null or older than 15 min) is treated as idle.
    $nor: [{ menuSyncStatus: 'syncing', syncingStartedAt: { $gte: staleBefore } }],
    $or: [
      { nextAutoSyncAt: { $lte: now } },
      { nextAutoSyncAt: null },
    ],
  });

  if (due.length === 0) return;

  for (const integration of due) {
    const hotelId  = integration.hotelId.toString();
    const platform = integration.platform as AggregatorPlatform;
    const intervalMs = integration.autoSyncIntervalMinutes * 60_000;

    try {
      const [categories, products] = await Promise.all([
        Category.find({ hotelId, isDeleted: { $ne: true } }).lean(),
        Product.find({ hotelId, isDeleted: false }).lean(),
      ]);

      await AggregatorService.syncMenu(hotelId, platform, categories, products, {
        triggeredBy: 'scheduled',
        syncType:    'scheduled',
      });

      // Advance next sync time from the current scheduled slot, not from wall clock,
      // so drift doesn't accumulate over missed cycles.
      const base = integration.nextAutoSyncAt ?? now;
      await AggregatorIntegration.findByIdAndUpdate(integration._id, {
        nextAutoSyncAt: new Date(base.getTime() + intervalMs),
      });
    } catch (err) {
      logger.error(`[menuSyncWorker] failed hotel=${hotelId} platform=${platform}`, { err: String(err) });
      // Retry after one interval even on failure — do not leave nextAutoSyncAt stale
      await AggregatorIntegration.findByIdAndUpdate(integration._id, {
        nextAutoSyncAt: new Date(now.getTime() + intervalMs),
      }).catch(() => undefined);
    }
  }
}
