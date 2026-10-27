import mongoose from 'mongoose';

/**
 * Print jobs to (re)send when a printer device registers (register_printer).
 *
 * Single-printer mode jobs are audit records only — the billing device prints
 * the receipt itself and the job is created with autoEmit=false, so it stays
 * 'pending' forever. Flushing those made the cashier device reprint every bill
 * of the last 24 h each time it reconnected; they're excluded here.
 */
export function flushablePrintJobsFilter(
  hotelId: string,
  printerRole: 'kitchen' | 'cashier',
  since: Date,
) {
  return {
    hotelId:       new mongoose.Types.ObjectId(hotelId),
    printerTarget: printerRole,
    printerMode:   { $ne: 'single' },
    // Also retry recently-failed jobs (e.g. Bluetooth was off last attempt)
    // but cap at 3 total attempts to avoid infinite retry loops.
    $or: [
      { status: 'pending' },
      { status: 'failed', attemptCount: { $lt: 3 } },
    ],
    createdAt: { $gte: since },
  };
}
