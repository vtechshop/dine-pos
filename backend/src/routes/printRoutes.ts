import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware,
  requireCashierOrAdmin,
  AuthRequest,
} from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { io } from '../server';
import PrintJob from '../models/PrintJob';
import PrinterDevice from '../models/PrinterDevice';

const router = Router();
router.use(authMiddleware);

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/print-jobs/devices
// List registered printer devices for this hotel with online/offline status.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/devices', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const devices = await PrinterDevice.find({
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
    }).select('deviceId printerName printerRole socketId connectedAt lastSeen lastHeartbeat').lean();

    const sixtySecsAgo = new Date(Date.now() - 60_000);
    const withStatus = (devices as any[]).map(d => ({
      ...d,
      online: !!d.socketId && !!d.lastHeartbeat && new Date(d.lastHeartbeat) > sixtySecsAgo,
    }));

    res.json({ devices: withStatus });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch printer devices', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/print-jobs
// List recent print jobs for this hotel (last 24 h).
// Optional query filters: status, jobType
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, jobType } = req.query as Record<string, string>;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const filter: Record<string, any> = {
      hotelId:   new mongoose.Types.ObjectId(req.hotelId),
      createdAt: { $gte: since },
    };
    if (status && ['pending', 'sent', 'success', 'failed'].includes(status)) {
      filter.status = status;
    }
    if (jobType && ['kot', 'receipt'].includes(jobType)) {
      filter.jobType = jobType;
    }

    const jobs = await PrintJob.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ jobs, total: jobs.length });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch print jobs', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/print-jobs/:jobId/status
// Mobile device reports print success or failure after executing the job.
// Auth required; no role restriction (called by kitchen, cashier, or admin devices).
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/:jobId/status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;
    const { status, errorMessage } = req.body as {
      status?:       string;
      errorMessage?: string;
    };

    if (!mongoose.isValidObjectId(jobId)) {
      res.status(400).json({ message: 'Invalid jobId' });
      return;
    }
    if (!['success', 'failed'].includes(status || '')) {
      res.status(400).json({ message: "status must be 'success' or 'failed'" });
      return;
    }

    const update: Record<string, any> = { status };
    if (status === 'success') {
      update.printedAt    = new Date();
      update.errorMessage = null;
    } else {
      update.errorMessage = String(errorMessage || 'Unknown print error').slice(0, 500);
    }

    const job = await PrintJob.findOneAndUpdate(
      { _id: jobId, hotelId: new mongoose.Types.ObjectId(req.hotelId) },
      { $set: update },
      { new: true },
    );
    if (!job) {
      res.status(404).json({ message: 'Print job not found' });
      return;
    }

    logger.info(`Print job ${status}`, {
      hotelId:        req.hotelId,
      jobId,
      jobType:        job.jobType,
      printerMode:    job.printerMode,
      printerAddress: job.printerAddress,
    });

    res.json({ job });
  } catch (err) {
    sendError(res, 500, 'Failed to update print job status', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/print-jobs/:jobId/reprint
// Re-emit the print_job socket event for a manual reprint.
// Increments attemptCount; resets status to 'sent'.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/:jobId/reprint', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;

    if (!mongoose.isValidObjectId(jobId)) {
      res.status(400).json({ message: 'Invalid jobId' });
      return;
    }

    const job = await PrintJob.findOne({
      _id:     jobId,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
    });
    if (!job) {
      res.status(404).json({ message: 'Print job not found' });
      return;
    }
    if (!job.printerAddress) {
      res.status(400).json({ message: 'No printer address on this job — update printer settings first' });
      return;
    }

    // Look up the registered device for this job's role
    const device = await PrinterDevice.findOne({
      hotelId:     new mongoose.Types.ObjectId(req.hotelId),
      printerRole: job.printerTarget,
    }).select('socketId').lean();

    const socketId = (device as any)?.socketId as string | null | undefined;
    if (!socketId) {
      res.status(503).json({ message: `No ${job.printerTarget} printer device online — connect the device first` });
      return;
    }

    await PrintJob.findByIdAndUpdate(jobId, {
      $set: { status: 'sent', sentAt: new Date(), errorMessage: null },
      $inc: { attemptCount: 1 },
    });

    io.to(socketId).emit('print_job', {
      jobId:          String(job._id),
      jobType:        job.jobType,
      printerTarget:  job.printerTarget,
      printerAddress: job.printerAddress,
      printerMode:    job.printerMode,
      payload:        job.payload,
    });

    logger.info('Print job reprint dispatched', {
      hotelId:        req.hotelId,
      jobId,
      jobType:        job.jobType,
      printerAddress: job.printerAddress,
      printerMode:    job.printerMode,
    });

    res.json({ message: 'Reprint dispatched', jobId });
  } catch (err) {
    sendError(res, 500, 'Failed to dispatch reprint', err);
  }
});

export default router;
