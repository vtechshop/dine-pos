// ─── OCR Pipeline — Gemini Vision Invoice Extraction ─────────────────────────
// Sends uploaded invoice (PDF/JPG/PNG) to Gemini Vision as inline data.
// Gemini extracts structured fields and normalises product names.
// Gemini NEVER writes to the database — it only returns parsed JSON.

import { getRedisClient } from '../config/redis'; // unused directly; imported to verify config path
import { logger } from '../utils/logger';
import { IExtractedInvoice, IExtractedItem } from '../models/OcrJob';

// ─── Gemini client setup ──────────────────────────────────────────────────────
// Reuse the same env var and model as geminiNarrative.ts

import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL   = process.env.GEMINI_MODEL   || 'gemini-2.5-flash';

// 60-second timeout for multimodal calls — PDFs can be large.
const OCR_TIMEOUT_MS = 60_000;

function getClient(): GoogleGenerativeAI | null {
  if (!API_KEY) return null;
  return new GoogleGenerativeAI(API_KEY);
}

function ocrTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Gemini OCR timeout after ${OCR_TIMEOUT_MS}ms`)),
        OCR_TIMEOUT_MS,
      ),
    ),
  ]);
}

// ─── File type validation (magic bytes) ──────────────────────────────────────
// Validate actual file content, not just the declared extension.

export type AllowedFileType = 'pdf' | 'jpg' | 'png';

export interface FileValidationResult {
  valid:    boolean;
  fileType: AllowedFileType | null;
  mimeType: string | null;
  error?:   string;
}

export function validateFileBuffer(buf: Buffer, originalName: string): FileValidationResult {
  if (buf.length === 0) return { valid: false, fileType: null, mimeType: null, error: 'File is empty' };
  if (buf.length > 10 * 1024 * 1024) return { valid: false, fileType: null, mimeType: null, error: 'File exceeds 10MB limit' };

  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { valid: true, fileType: 'pdf', mimeType: 'application/pdf' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { valid: true, fileType: 'jpg', mimeType: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { valid: true, fileType: 'png', mimeType: 'image/png' };
  }

  const ext = originalName.split('.').pop()?.toLowerCase();
  return {
    valid: false,
    fileType: null,
    mimeType: null,
    error: `Unsupported file type (extension: .${ext ?? '?'}). Only PDF, JPG, and PNG are accepted.`,
  };
}

// ─── Gemini JSON parser ───────────────────────────────────────────────────────
// Gemini may wrap JSON in markdown code fences — strip before parsing.

function parseGeminiJSON(text: string): unknown {
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in Gemini response');
  return JSON.parse(match[0]);
}

// ─── Field coercion ───────────────────────────────────────────────────────────

function coerceNumber(v: unknown): number {
  const n = parseFloat(String(v ?? '0').replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : Math.max(0, n);
}

function coerceString(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeInvoiceData(raw: Record<string, unknown>): IExtractedInvoice {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];

  const items: IExtractedItem[] = rawItems.map((it: unknown) => {
    const item = (typeof it === 'object' && it !== null ? it : {}) as Record<string, unknown>;
    const qty      = coerceNumber(item.quantity ?? item.qty);
    const price    = coerceNumber(item.unitPrice ?? item.unit_price ?? item.rate ?? item.price);
    const tax      = coerceNumber(item.taxPercent ?? item.tax_percent ?? item.tax ?? item.gst);
    const line     = coerceNumber(item.lineTotal ?? item.line_total ?? item.amount ?? item.total);
    return {
      productName:  coerceString(item.productName ?? item.product_name ?? item.description ?? item.name),
      quantity:     qty,
      unit:         coerceString(item.unit ?? 'pcs'),
      unitPrice:    price,
      taxPercent:   tax,
      lineTotal:    line > 0 ? line : +(qty * price * (1 + tax / 100)).toFixed(2),
      ingredientId: null,
    };
  });

  const subtotal    = coerceNumber(raw.subtotal ?? raw.sub_total);
  const taxTotal    = coerceNumber(raw.taxTotal ?? raw.tax_total ?? raw.taxAmount ?? raw.gstAmount);
  const totalAmount = coerceNumber(raw.totalAmount ?? raw.total_amount ?? raw.total ?? raw.grandTotal);

  return {
    vendorName:    coerceString(raw.vendorName ?? raw.vendor_name ?? raw.supplier ?? raw.sellerName),
    invoiceNumber: coerceString(raw.invoiceNumber ?? raw.invoice_number ?? raw.invoiceNo ?? raw.billNo),
    invoiceDate:   coerceString(raw.invoiceDate ?? raw.invoice_date ?? raw.date),
    gstNumber:     coerceString(raw.gstNumber ?? raw.gst_number ?? raw.gstin ?? raw.vendorGstin),
    items,
    subtotal,
    taxTotal,
    totalAmount:   totalAmount > 0 ? totalAmount : +(subtotal + taxTotal).toFixed(2),
    cleanupNotes:  coerceString(raw.cleanupNotes ?? raw.cleanup_notes ?? raw.notes ?? raw.corrections),
  };
}

// ─── Gemini OCR prompt ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Extract all fields from this supplier invoice and return ONLY a JSON object.

Required JSON format (no markdown, no extra text):
{
  "vendorName": "supplier business name",
  "invoiceNumber": "invoice/bill number",
  "invoiceDate": "date in original format",
  "gstNumber": "GST/GSTIN number if present, else empty string",
  "items": [
    {
      "productName": "normalized product name",
      "quantity": 0,
      "unit": "unit of measure (kg/litre/pcs/box etc)",
      "unitPrice": 0,
      "taxPercent": 0,
      "lineTotal": 0
    }
  ],
  "subtotal": 0,
  "taxTotal": 0,
  "totalAmount": 0,
  "cleanupNotes": "note any corrections, illegible fields, or normalizations you applied"
}

Rules:
- Return ONLY the JSON object — no explanations, no markdown
- All numeric values must be plain numbers (no currency symbols)
- Normalize product names: capitalize properly, fix obvious OCR errors
- If a field is missing or illegible, use empty string for text or 0 for numbers
- Do NOT invent data — only extract what is visible`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function extractInvoiceData(
  fileData:    string,  // base64-encoded file content
  mimeType:    string,  // 'application/pdf' | 'image/jpeg' | 'image/png'
  fileName:    string,
): Promise<IExtractedInvoice | null> {
  const client = getClient();
  if (!client) {
    logger.warn('[ocrPipeline] GEMINI_API_KEY not set — OCR unavailable');
    return null;
  }

  try {
    const model  = client.getGenerativeModel({ model: MODEL });
    const result = await ocrTimeout(model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: fileData } },
          { text: EXTRACTION_PROMPT },
        ],
      }],
    }));

    const text = result.response.text();
    if (!text) {
      logger.warn('[ocrPipeline] Empty response from Gemini', { fileName });
      return null;
    }

    const raw  = parseGeminiJSON(text) as Record<string, unknown>;
    const data = normalizeInvoiceData(raw);

    logger.info('[ocrPipeline] Extraction complete', {
      fileName,
      vendor:      data.vendorName,
      invoice:     data.invoiceNumber,
      itemCount:   data.items.length,
      total:       data.totalAmount,
    });

    return data;
  } catch (err) {
    logger.error('[ocrPipeline] Extraction failed', { fileName, err: String(err) });
    return null;
  }
}
