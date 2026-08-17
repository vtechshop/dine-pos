import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import {
  ScanLine, Upload, CheckCircle, AlertTriangle, Loader2,
  FileText, ShoppingCart, Info, RefreshCw,
} from 'lucide-react';
import {
  uploadOcrInvoice, fetchOcrJob, fetchOcrJobReview,
  fetchOcrJobs, approveOcrJob, rejectOcrJob,
  type OcrJob, type OcrJobStatus, type OcrReviewScreen, type OcrFileType,
} from '../../api/aiOcr';
import {
  fetchPurchaseSuggestions,
  type PurchaseSuggestion, type PurchaseSuggestionResult,
} from '../../api/aiForecast';

const POLL_MS   = 3000;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_OK   = ['application/pdf', 'image/jpeg', 'image/png'];

const toFileType = (m: string): OcrFileType =>
  m === 'application/pdf' ? 'pdf' : m === 'image/png' ? 'png' : 'jpg';
const confCls = (c: number) =>
  c >= 0.9 ? 'bg-green-500' : c >= 0.6 ? 'bg-amber-400' : 'bg-red-400';
const fmt = (n?: number) =>
  n != null ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const STATUS_CLS: Record<OcrJobStatus, string> = {
  pending:    'bg-gray-100 text-gray-500',
  processing: 'bg-blue-100 text-blue-600 animate-pulse',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
  rejected:   'bg-red-100 text-red-500',
};

const URGENCY_CLS: Record<PurchaseSuggestion['urgency'], string> = {
  critical: 'bg-red-100 text-red-700',
  soon:     'bg-amber-100 text-amber-700',
  plan:     'bg-gray-100 text-gray-500',
};

type ActiveTab = 'scanner' | 'intelligence';

function Badge({ status }: { status: OcrJobStatus }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_CLS[status]}`}>
      {status}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PurchaseAssistantPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');

  // ── Scanner state ──────────────────────────────────────────────────────────
  const [jobs, setJobs]                         = useState<OcrJob[]>([]);
  const [loadingJobs, setLoadingJobs]           = useState(true);
  const [selectedJobId, setSelectedJobId]       = useState<string | null>(null);
  const [review, setReview]                     = useState<OcrReviewScreen | null>(null);
  const [loadingReview, setLoadingReview]       = useState(false);
  const [uploadError, setUploadError]           = useState<string | null>(null);
  const [uploading, setUploading]               = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [submitting, setSubmitting]             = useState(false);
  const [approved, setApproved]                 = useState(false);
  const [submitError, setSubmitError]           = useState<string | null>(null);

  // ── Intelligence state ─────────────────────────────────────────────────────
  const [intel, setIntel]               = useState<PurchaseSuggestionResult | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError]     = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadJobs = useCallback(async () => {
    try { const r = await fetchOcrJobs({ limit: 20 }); setJobs(r.jobs); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLoadingJobs(true);
    void loadJobs().finally(() => setLoadingJobs(false));
  }, [loadJobs]);

  // Poll pending/processing jobs every 3 s
  useEffect(() => {
    const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
    if (!active.length) return;
    const timer = setInterval(async () => {
      const settled = await Promise.allSettled(active.map(j => fetchOcrJob(j._id)));
      const changed: OcrJob[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.status !== active[i].status) changed.push(r.value);
      });
      if (!changed.length) return;
      setJobs(prev => {
        const m = new Map(changed.map(j => [j._id, j] as [string, OcrJob]));
        return prev.map(j => m.get(j._id) ?? j);
      });
      const sel = changed.find(j => j._id === selectedJobId);
      if (sel?.status === 'completed') {
        setLoadingReview(true);
        fetchOcrJobReview(sel._id)
          .then(r => { setReview(r); setLoadingReview(false); })
          .catch(() => setLoadingReview(false));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobs, selectedJobId]);

  // Load review when selection changes
  useEffect(() => {
    setSelectedVendorId(null); setApproved(false); setReview(null); setSubmitError(null);
    if (!selectedJobId) return;
    const job = jobs.find(j => j._id === selectedJobId);
    if (job?.status === 'completed') {
      setLoadingReview(true);
      fetchOcrJobReview(selectedJobId)
        .then(setReview).catch(() => {}).finally(() => setLoadingReview(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]); // intentional: only re-run on selection change; polling handles transitions

  // Load purchase intelligence when tab is first selected
  const loadIntel = useCallback(async () => {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const data = await fetchPurchaseSuggestions();
      setIntel(data);
    } catch (err) {
      setIntelError(err instanceof Error ? err.message : 'Failed to load purchase suggestions.');
    } finally {
      setIntelLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'intelligence' && !intel && !intelLoading) {
      void loadIntel();
    }
  }, [activeTab, intel, intelLoading, loadIntel]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_BYTES) { setUploadError('File must be under 10 MB.'); return; }
    if (!MIME_OK.includes(file.type)) { setUploadError('Only PDF, JPG, or PNG files are allowed.'); return; }
    setUploading(true);
    try {
      const res = await uploadOcrInvoice(file);
      const now = new Date().toISOString();
      const newJob: OcrJob = {
        _id: res.jobId, hotelId: '', status: 'pending', fileName: res.fileName,
        fileType: toFileType(file.type), fileSizeBytes: file.size,
        fileMimeType: file.type, createdAt: now, updatedAt: now,
      };
      setJobs(prev => [newJob, ...prev]);
      setSelectedJobId(res.jobId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally { setUploading(false); }
  }

  async function handleApprove() {
    if (!selectedJobId || !selectedVendorId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await approveOcrJob(selectedJobId, selectedVendorId);
      setApproved(true);
      await loadJobs();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Approval failed. Please try again.');
    } finally { setSubmitting(false); }
  }

  async function handleReject() {
    if (!selectedJobId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await rejectOcrJob(selectedJobId);
      await loadJobs();
      setSelectedJobId(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Rejection failed. Please try again.');
    } finally { setSubmitting(false); }
  }

  const selectedJob  = jobs.find(j => j._id === selectedJobId);
  const isProcessing = selectedJob?.status === 'pending' || selectedJob?.status === 'processing' || loadingReview;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10">
            <ScanLine size={16} className="text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-ink">Purchase Assistant</h1>
            <p className="text-[11px] text-ink/40">AI-powered procurement tools</p>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="shrink-0 flex border-b border-border bg-canvas px-4">
        {([
          { id: 'scanner',      label: 'Invoice Scanner' },
          { id: 'intelligence', label: 'Purchase Intelligence' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-brand text-brand'
                : 'border-transparent text-ink/50 hover:text-ink/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {activeTab === 'scanner' ? (

        <div className="flex flex-1 overflow-hidden">

          {/* Left panel — job list (hidden on mobile when a job is selected) */}
          <div className={`flex-col border-r border-border bg-canvas lg:w-80 lg:shrink-0 ${selectedJobId ? 'hidden lg:flex' : 'flex w-full'}`}>
            <div className="shrink-0 border-b border-border p-4">
              <input
                ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
                className="hidden" onChange={e => void handleFile(e)}
              />
              <button
                onClick={() => { setUploadError(null); fileRef.current?.click(); }}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {uploading ? 'Uploading…' : 'Upload Invoice'}
              </button>
              {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingJobs ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="space-y-1.5 rounded-xl border border-border p-3">
                      <div className="animate-pulse rounded bg-border h-3 w-3/4" />
                      <div className="animate-pulse rounded bg-border h-2.5 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <FileText size={28} className="text-ink/20" />
                  <p className="text-xs text-ink/40">No invoices yet</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {jobs.map(job => (
                    <button
                      key={job._id}
                      onClick={() => setSelectedJobId(job._id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selectedJobId === job._id
                          ? 'border-brand/30 bg-brand/5'
                          : 'border-border bg-canvas hover:bg-mist'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-ink">{job.fileName}</p>
                        <Badge status={job.status} />
                      </div>
                      <p className="mt-1 text-[10px] text-ink/40">{fmtTime(job.createdAt)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel — detail (visible on mobile when a job is selected) */}
          <div className={`flex-col overflow-hidden ${selectedJobId ? 'flex flex-1' : 'hidden lg:flex lg:flex-1'}`}>
            {/* Mobile back button */}
            {selectedJobId && (
              <button
                onClick={() => setSelectedJobId(null)}
                className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2.5 text-xs font-medium text-ink/60 hover:text-ink lg:hidden"
              >
                ← Back to invoices
              </button>
            )}
            {!selectedJobId ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
                  <ScanLine size={32} className="text-brand" />
                </div>
                <div>
                  <p className="font-semibold text-ink">Upload an invoice to get started</p>
                  <p className="mt-1 text-sm text-ink/40">Supports PDF, JPG, and PNG up to 10 MB</p>
                </div>
              </div>
            ) : isProcessing ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Loader2 size={36} className="animate-spin text-brand" />
                <p className="font-semibold text-ink">Processing your invoice with AI…</p>
                <p className="text-sm text-ink/50">This may take 30–60 seconds</p>
              </div>
            ) : selectedJob?.status === 'failed' ? (
              <div className="flex-1 overflow-y-auto p-5">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle size={16} />
                    <span className="text-sm font-semibold">Processing failed</span>
                  </div>
                  {selectedJob.errorMessage && (
                    <p className="mt-2 text-sm text-red-500">{selectedJob.errorMessage}</p>
                  )}
                </div>
              </div>
            ) : selectedJob?.status === 'rejected' ? (
              <div className="flex-1 overflow-y-auto p-5">
                <div className="rounded-xl border border-border bg-mist p-4 text-sm text-ink/60">
                  This invoice was rejected.
                </div>
              </div>
            ) : approved ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle size={28} className="text-green-600" />
                </div>
                <p className="font-semibold text-ink">Invoice approved &amp; imported</p>
                {selectedJob?.createdPoId && (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                    PO Created: {selectedJob.createdPoId}
                  </span>
                )}
              </div>
            ) : review ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">

                {/* Duplicate warning */}
                {review.duplicateWarning?.isDuplicate && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle size={15} />
                      <span className="text-sm font-semibold">Possible duplicate invoice</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-600">{review.duplicateWarning.reason}</p>
                  </div>
                )}

                {/* Extracted data */}
                <div className="rounded-xl border border-border bg-canvas p-4">
                  <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">Extracted Data</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    {([
                      ['Invoice #', review.extractedData.invoiceNumber ?? '—'],
                      ['Date',      review.extractedData.invoiceDate    ?? '—'],
                      ['Vendor',    review.extractedData.vendorName     ?? '—'],
                      ['GST',       review.extractedData.vendorGST      ?? '—'],
                      ['Total',     fmt(review.extractedData.totalAmount)],
                      ['Tax',       fmt(review.extractedData.taxAmount)],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label}>
                        <p className="text-[10px] uppercase tracking-wide text-ink/40">{label}</p>
                        <p className="mt-0.5 font-medium text-ink">{val}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vendor matches */}
                {review.vendorMatches.length > 0 && (
                  <div className="rounded-xl border border-border bg-canvas p-4">
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">Vendor Matches</h2>
                    <div className="space-y-2">
                      {review.vendorMatches.slice(0, 3).map(vm => (
                        <div
                          key={vm.vendorId}
                          className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                            selectedVendorId === vm.vendorId ? 'border-brand/40 bg-brand/5' : 'border-border'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">{vm.businessName}</p>
                            <p className="text-xs text-ink/50">{vm.gstNumber}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-border">
                                <div
                                  className={`h-1.5 rounded-full ${confCls(vm.confidence)}`}
                                  style={{ width: `${Math.round(vm.confidence * 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-ink/40">
                                {Math.round(vm.confidence * 100)}%
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedVendorId(vm.vendorId)}
                            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                              selectedVendorId === vm.vendorId
                                ? 'bg-brand text-white'
                                : 'border border-border text-ink/60 hover:border-brand/40 hover:text-brand'
                            }`}
                          >
                            {selectedVendorId === vm.vendorId ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Line items */}
                {(review.extractedData.lineItems?.length ?? 0) > 0 && (
                  <div className="rounded-xl border border-border bg-canvas p-4">
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">Line Items</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink/40">
                            <th className="pb-2 pr-2 font-semibold">Description</th>
                            <th className="pb-2 font-semibold text-right">Qty</th>
                            <th className="pb-2 px-2 font-semibold">Unit</th>
                            <th className="pb-2 font-semibold text-right">Unit Price</th>
                            <th className="pb-2 font-semibold text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.extractedData.lineItems!.map((li, i) => (
                            <tr key={i} className="border-b border-border/40 last:border-0">
                              <td className="py-2 pr-2 text-ink">{li.description}</td>
                              <td className="py-2 text-right text-ink/70">{li.qty}</td>
                              <td className="py-2 px-2 text-ink/50">{li.unit ?? '—'}</td>
                              <td className="py-2 text-right text-ink/70">{fmt(li.unitPrice)}</td>
                              <td className="py-2 text-right font-semibold text-ink">{fmt(li.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pb-2">
                  <button
                    onClick={() => void handleApprove()}
                    disabled={!selectedVendorId || submitting}
                    className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                  >
                    {submitting ? 'Approving…' : 'Approve & Import'}
                  </button>
                  <button
                    onClick={() => void handleReject()}
                    disabled={submitting}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink/60 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
                {submitError && (
                  <p className="text-center text-xs text-red-600 pb-2">{submitError}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>

      ) : (

        /* ── Purchase Intelligence Tab ─────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {intelLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <Loader2 size={32} className="animate-spin text-brand" />
              <p className="text-sm text-ink/50">Analysing stock levels and generating suggestions…</p>
            </div>
          ) : intelError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between">
              <span className="text-sm text-red-600">{intelError}</span>
              <button
                onClick={() => void loadIntel()}
                className="ml-4 shrink-0 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : intel ? (
            <>
              {/* Data limitations banner */}
              {intel.limitations.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2.5">
                  <Info size={15} className="mt-0.5 shrink-0 text-blue-500" />
                  <div className="space-y-0.5">
                    {intel.limitations.map((lim, i) => (
                      <p key={i} className="text-xs text-blue-700">{lim}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Total estimated cost */}
              {intel.totalEstimatedCost > 0 && (
                <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={15} className="text-brand" />
                    <span className="text-xs font-semibold text-ink/70">Total Estimated Procurement Cost</span>
                  </div>
                  <span className="text-base font-bold tabular-nums text-ink">
                    {fmt(intel.totalEstimatedCost)}
                  </span>
                </div>
              )}

              {/* Empty state */}
              {intel.suggestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100">
                    <CheckCircle size={28} className="text-green-600" />
                  </div>
                  <p className="font-semibold text-ink">All stock levels are adequate</p>
                  <p className="text-sm text-ink/40">No purchase suggestions at this time.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-mist text-left text-[10px] uppercase tracking-wide text-ink/40">
                          <th className="px-4 py-3 font-semibold">Item</th>
                          <th className="px-3 py-3 font-semibold">Current Stock</th>
                          <th className="px-3 py-3 font-semibold">Urgency</th>
                          <th className="px-3 py-3 font-semibold text-right">Suggested Qty</th>
                          <th className="px-3 py-3 font-semibold text-right">Est. Cost</th>
                          <th className="px-3 py-3 font-semibold">Pending PO</th>
                          <th className="px-4 py-3 font-semibold">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intel.suggestions.map((s, i) => (
                          <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-mist/50 transition-colors">
                            <td className="px-4 py-3 font-medium text-ink">{s.itemName}</td>
                            <td className="px-3 py-3 tabular-nums text-ink/70">{s.currentStock} {s.unit}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${URGENCY_CLS[s.urgency]}`}>
                                {s.urgency}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-ink/70">{s.suggestedQty}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-ink/70">{fmt(s.estimatedCost)}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                s.hasPendingPO ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {s.hasPendingPO ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-ink/60 leading-snug max-w-xs" title={s.reason}>
                              <span className="line-clamp-2">{s.reason}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

      )}
    </div>
  );
}
