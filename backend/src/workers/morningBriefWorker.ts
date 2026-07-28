// ─── Morning Brief Worker ────────────────────────────────────────────────────
// Dispatches morning brief generation for hotels due in the current minute.
// Called every minute during UTC 04:00–05:59 (minuteOfDay 240–359).
// Mirrors the daily snapshot dispatch pattern: lock + stagger + batch.

import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import JobRegistry from '../models/JobRegistry';
import { acquireSchedulerLock, releaseSchedulerLock } from '../utils/schedulerLock';
import { buildMorningBrief } from '../services/morningBriefBuilder';
import { logger } from '../utils/logger';

const BRIEF_BATCH_SIZE = 5;
const JOB_NAME        = 'morning-brief';

// Stagger slot within the 120-minute brief window (minuteOfDay 240–359).
// Each hotel's slot is deterministic: same hotel always runs in the same UTC minute.
export function morningBriefSlot(hotelId: string): number {
  return 240 + (parseInt(hotelId.slice(-8), 16) % 120);
}

export async function dispatchMorningBriefs(minuteOfDay: number): Promise<void> {
  const jobStart = Date.now();
  const lockName = `morning-brief-m${minuteOfDay}`;

  const acquired = await acquireSchedulerLock(lockName, 5 * 60);
  if (!acquired) return;

  // Yesterday UTC — the date whose data is now finalized
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await JobRegistry.findOneAndUpdate(
    { jobName: JOB_NAME },
    { $set: { lastRunAt: new Date(), lastRunStatus: 'running', lastError: null } },
    { upsert: true },
  );

  const hotels = await Hotel.find(
    { status: { $in: ['active', 'trial'] } },
    { _id: 1 },
  ).lean();

  const due = hotels.filter((h) => morningBriefSlot(h._id.toString()) === minuteOfDay);

  try {
    if (due.length === 0) {
      await JobRegistry.findOneAndUpdate(
        { jobName: JOB_NAME },
        { $set: { lastRunStatus: 'success', hotelsProcessed: 0, hotelsFailed: 0, durationMs: Date.now() - jobStart } },
      );
      await releaseSchedulerLock(lockName);
      return;
    }

    logger.info(`[morningBrief] minute=${minuteOfDay} dispatching ${due.length} hotel(s) for ${yesterday}`);

    let processed = 0;
    let failed    = 0;
    let lastError: string | null = null;

    for (let i = 0; i < due.length; i += BRIEF_BATCH_SIZE) {
      const batch   = due.slice(i, i + BRIEF_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((h) => buildMorningBrief(h._id.toString(), yesterday)),
      );
      for (let j = 0; j < results.length; j++) {
        const r   = results[j];
        const hid = (batch[j]?._id as mongoose.Types.ObjectId)?.toString() ?? 'unknown';
        if (r.status === 'fulfilled') {
          processed++;
        } else {
          failed++;
          lastError = `hotel:${hid} — ${String(r.reason)}`;
          logger.error('[morningBrief] hotel failed', { hotelId: hid, reason: String(r.reason) });
        }
      }
    }

    await JobRegistry.findOneAndUpdate(
      { jobName: JOB_NAME },
      { $set: { lastRunStatus: failed > 0 ? 'partial' : 'success', hotelsProcessed: processed, hotelsFailed: failed, lastError, durationMs: Date.now() - jobStart } },
    );
  } finally {
    await releaseSchedulerLock(lockName);
  }
}
