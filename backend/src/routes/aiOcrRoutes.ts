import { Router, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import OcrJob from '../models/OcrJob';
import { validateFileBuffer } from '../services/ocrPipeline';
import {
  getReviewScreen,
  updateReviewedData,
  approveOcrJob,
  rejectOcrJob,
} from '../services/purchaseSuggestion';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin); // only admin users can import invoices

// Multer: in-memory, max 10MB, single file
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ─── POST /api/ai/ocr/upload ──────────────────────────────────────────────────
// Accepts PDF/JPG/PNG invoice. Validates file type via magic bytes.
// Creates OcrJob with status=pending and returns jobId immediately.
// Background worker picks it up within 10 seconds.

router.post('/ocr/upload', upload.single('invoice'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded. Field name must be "invoice".' });
    }

    const { buffer, originalname, size } = req.file;

    // Validate by magic bytes, not extension
    const validation = validateFileBuffer(buffer, originalname ?? 'file');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const hotelOId = new mongoose.Types.ObjectId(req.hotelId!);
    const job = await OcrJob.create({
      hotelId:       hotelOId,
      status:        'pending',
      fileName:      originalname ?? 'invoice',
      fileType:      validation.fileType!,
      fileSizeBytes: size,
      fileMimeType:  validation.mimeType!,
      fileData:      buffer.toString('base64'),
    });

    return res.status(202).json({
      jobId:    job._id.toString(),
      status:   'pending',
      fileName: job.fileName,
      message:  'Invoice queued for OCR processing. Poll /api/ai/ocr/job/:jobId for status.',
    });
  } catch (err) {
    sendError(res, 500, 'Failed to queue OCR job', err);
  }
});

// ─── GET /api/ai/ocr/job/:jobId ───────────────────────────────────────────────
// Poll job status. Returns status + summary (no fileData — cleared after OCR).

router.get('/ocr/job/:jobId', async (req: AuthRequest, res: Response) => {
  try {
    const hotelOId = new mongoose.Types.ObjectId(req.hotelId!);
    const job = await OcrJob.findOne(
      { _id: req.params.jobId, hotelId: hotelOId },
      { fileData: 0 }, // never return raw file bytes
    ).lean();

    if (!job) return res.status(404).json({ message: 'OCR job not found' });
    return res.json(job);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch OCR job', err);
  }
});

// ─── GET /api/ai/ocr/job/:jobId/review ────────────────────────────────────────
// Returns structured review screen: extracted data + vendor matches + warnings.
// Only meaningful when status=completed.

router.get('/ocr/job/:jobId/review', async (req: AuthRequest, res: Response) => {
  try {
    const screen = await getReviewScreen(req.hotelId!, req.params.jobId);
    if (!screen) return res.status(404).json({ message: 'OCR job not found' });

    if (screen.status === 'pending' || screen.status === 'processing') {
      return res.status(202).json({
        message: `Job is still ${screen.status}. Check back in a few seconds.`,
        status:  screen.status,
      });
    }
    return res.json(screen);
  } catch (err) {
    sendError(res, 500, 'Failed to get review screen', err);
  }
});

// ─── PUT /api/ai/ocr/job/:jobId/review ────────────────────────────────────────
// Save user edits to OCR result before approval.
// Body: { reviewedData: IExtractedInvoice, selectedVendorId?: string }

router.put('/ocr/job/:jobId/review', async (req: AuthRequest, res: Response) => {
  try {
    const { reviewedData, selectedVendorId } = req.body as {
      reviewedData?:    unknown;
      selectedVendorId?: unknown;
    };

    if (!reviewedData || typeof reviewedData !== 'object') {
      return res.status(400).json({ message: 'reviewedData object is required' });
    }

    const sid = typeof selectedVendorId === 'string' ? selectedVendorId : null;
    const ok  = await updateReviewedData(
      req.hotelId!,
      req.params.jobId,
      reviewedData as any,
      sid,
    );

    if (!ok) {
      return res.status(409).json({
        message: 'Job not found or not in completed state. Cannot update review data.',
      });
    }

    return res.json({ success: true, jobId: req.params.jobId });
  } catch (err) {
    sendError(res, 500, 'Failed to update review data', err);
  }
});

// ─── POST /api/ai/ocr/job/:jobId/approve ─────────────────────────────────────
// Approve and import: creates PO + GRN + stock update + WAC + ledger.
// User must have reviewed and selected a vendor.
// Body: { selectedVendorId: string, reviewedData?: IExtractedInvoice }

router.post('/ocr/job/:jobId/approve', async (req: AuthRequest, res: Response) => {
  try {
    const { selectedVendorId, reviewedData } = req.body as {
      selectedVendorId?: unknown;
      reviewedData?:     unknown;
    };

    if (typeof selectedVendorId !== 'string' || !selectedVendorId.trim()) {
      return res.status(400).json({ message: 'selectedVendorId is required' });
    }

    const approvedBy = req.cashierId ?? req.waiterId ?? 'admin';
    const result = await approveOcrJob(
      req.hotelId!,
      req.params.jobId,
      selectedVendorId.trim(),
      reviewedData as any,
      approvedBy,
    );

    return res.status(201).json(result);
  } catch (err: any) {
    if (err?.message?.includes('not in completed state') || err?.message?.includes('not found')) {
      return res.status(409).json({ message: err.message });
    }
    sendError(res, 500, 'Failed to approve OCR job', err);
  }
});

// ─── POST /api/ai/ocr/job/:jobId/reject ──────────────────────────────────────
// Reject an OCR job — marks it as rejected without creating any records.
// Body: { reason?: string }

router.post('/ocr/job/:jobId/reject', async (req: AuthRequest, res: Response) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const ok = await rejectOcrJob(req.hotelId!, req.params.jobId, reason);
    if (!ok) {
      return res.status(409).json({ message: 'Job not found or already approved/rejected' });
    }
    return res.json({ success: true, jobId: req.params.jobId });
  } catch (err) {
    sendError(res, 500, 'Failed to reject OCR job', err);
  }
});

// ─── GET /api/ai/ocr/jobs ────────────────────────────────────────────────────
// List recent OCR jobs for this hotel (last 50).

router.get('/ocr/jobs', async (req: AuthRequest, res: Response) => {
  try {
    const hotelOId = new mongoose.Types.ObjectId(req.hotelId!);
    const { status, limit = '50', skip = '0' } = req.query;

    const filter: Record<string, unknown> = { hotelId: hotelOId };
    if (typeof status === 'string') filter.status = status;

    const lim = Math.min(Math.max(1, parseInt(String(limit), 10) || 50), 100);
    const sk  = Math.max(0, parseInt(String(skip), 10) || 0);

    const [jobs, total] = await Promise.all([
      OcrJob.find(filter, { fileData: 0 }) // never return raw file bytes
        .sort({ createdAt: -1 })
        .skip(sk)
        .limit(lim)
        .lean(),
      OcrJob.countDocuments(filter),
    ]);

    return res.json({ jobs, total, limit: lim, skip: sk });
  } catch (err) {
    sendError(res, 500, 'Failed to list OCR jobs', err);
  }
});

export default router;
