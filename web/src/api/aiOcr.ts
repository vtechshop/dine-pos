import { apiFetch } from './client';

export type OcrJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rejected';
export type OcrFileType  = 'pdf' | 'jpg' | 'png';

export interface OcrVendorMatch {
  vendorId:     string;
  businessName: string;
  gstNumber:    string;
  confidence:   number;
}

export interface OcrDuplicateWarning {
  isDuplicate:  boolean;
  reason:       string;
  matchedJobId: string | null;
  matchedPoId:  string | null;
}

export interface ExtractedInvoice {
  invoiceNumber?: string;
  invoiceDate?:   string;
  vendorName?:    string;
  vendorGST?:     string;
  totalAmount?:   number;
  taxAmount?:     number;
  lineItems?:     Array<{
    description: string;
    qty:         number;
    unit?:       string;
    unitPrice:   number;
    total:       number;
  }>;
}

export interface OcrJob {
  _id:              string;
  hotelId:          string;
  status:           OcrJobStatus;
  fileName:         string;
  fileType:         OcrFileType;
  fileSizeBytes:    number;
  fileMimeType:     string;
  createdAt:        string;
  updatedAt:        string;
  extractedData?:   ExtractedInvoice;
  reviewedData?:    ExtractedInvoice;
  vendorMatches?:   OcrVendorMatch[];
  duplicateWarning?: OcrDuplicateWarning;
  createdPoId?:     string | null;
  errorMessage?:    string;
}

export interface OcrJobsResponse {
  jobs:  OcrJob[];
  total: number;
  limit: number;
  skip:  number;
}

export interface OcrUploadResponse {
  jobId:    string;
  status:   'pending';
  fileName: string;
  message:  string;
}

export interface OcrReviewScreen {
  jobId:              string;
  status:             OcrJobStatus;
  fileName:           string;
  extractedData:      ExtractedInvoice;
  reviewedData:       ExtractedInvoice | null;
  vendorMatches:      OcrVendorMatch[];
  duplicateWarning:   OcrDuplicateWarning | null;
  purchaseSuggestion: unknown;
}

export function uploadOcrInvoice(file: File): Promise<OcrUploadResponse> {
  const fd = new FormData();
  fd.append('invoice', file);
  return apiFetch('/ai/ocr/upload', { method: 'POST', body: fd });
}

export function fetchOcrJob(jobId: string): Promise<OcrJob> {
  return apiFetch(`/ai/ocr/job/${jobId}`);
}

export function fetchOcrJobReview(jobId: string): Promise<OcrReviewScreen> {
  return apiFetch(`/ai/ocr/job/${jobId}/review`);
}

export function fetchOcrJobs(params?: {
  status?: OcrJobStatus;
  limit?:  number;
  skip?:   number;
}): Promise<OcrJobsResponse> {
  const q = new URLSearchParams();
  if (params?.status !== undefined) q.set('status', params.status);
  if (params?.limit  !== undefined) q.set('limit',  String(params.limit));
  if (params?.skip   !== undefined) q.set('skip',   String(params.skip));
  const qs = q.toString();
  return apiFetch(`/ai/ocr/jobs${qs ? `?${qs}` : ''}`);
}

export function approveOcrJob(
  jobId:            string,
  selectedVendorId: string,
  reviewedData?:    ExtractedInvoice,
): Promise<unknown> {
  return apiFetch(`/ai/ocr/job/${jobId}/approve`, {
    method: 'POST',
    body:   JSON.stringify({ selectedVendorId, ...(reviewedData ? { reviewedData } : {}) }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function rejectOcrJob(
  jobId:   string,
  reason?: string,
): Promise<{ success: boolean; jobId: string }> {
  return apiFetch(`/ai/ocr/job/${jobId}/reject`, {
    method:  'POST',
    body:    JSON.stringify({ reason }),
    headers: { 'Content-Type': 'application/json' },
  });
}
