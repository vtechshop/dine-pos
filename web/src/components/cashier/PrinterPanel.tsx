import { useState, useEffect, useCallback } from 'react';
import { Printer, Wifi, WifiOff, RefreshCw, RotateCcw, AlertCircle, Clock } from 'lucide-react';
import { fetchPrinterDevices } from '../../api/dashboard';
import { fetchReceiptJobs, reprintJob } from '../../api/billing';
import { Spinner } from '../ui/Spinner';
import type { PrinterDeviceStatus, PrintJob } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(nowMs: number, iso: string | null | undefined) {
  if (!iso) return 'never';
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const JOB_STATUS_STYLE: Record<string, string> = {
  success: 'text-emerald-600',
  sent:    'text-brand',
  pending: 'text-amber-600',
  failed:  'text-red-500',
};

// ── Printer card ──────────────────────────────────────────────────────────────

function PrinterCard({ printer, nowMs }: { printer: PrinterDeviceStatus; nowMs: number }) {
  const isOnline = printer.online &&
    !!printer.lastHeartbeat &&
    nowMs - new Date(printer.lastHeartbeat).getTime() < 3 * 60_000;

  return (
    <div className={`rounded-xl border p-3 ${isOnline ? 'border-emerald-200 bg-emerald-50/40' : 'border-border bg-canvas'}`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-mist text-ink/35'}`}>
          <Printer size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink truncate">
              {printer.printerName ?? 'Unnamed Printer'}
            </p>
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-500'
            }`}>
              {isOnline ? <Wifi size={9} /> : <WifiOff size={9} />}
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] capitalize text-ink/50">
            {printer.printerRole} printer
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-ink/40 flex items-center gap-1 justify-end">
            <Clock size={9} />
            {fmtAge(nowMs, printer.lastHeartbeat)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Print job row ─────────────────────────────────────────────────────────────

function JobRow({ job, nowMs, onReprint }: { job: PrintJob; nowMs: number; onReprint: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold capitalize ${JOB_STATUS_STYLE[job.status] ?? 'text-ink/50'}`}>
            {job.status}
          </span>
          <span className="text-[10px] text-ink/30">·</span>
          <span className="text-[10px] capitalize text-ink/45">{job.jobType}</span>
        </div>
        <p className="text-[10px] text-ink/40">{fmtAge(nowMs, job.createdAt)} · Attempt {job.attemptCount}</p>
        {job.errorMessage && (
          <p className="mt-0.5 text-[10px] text-red-500 truncate">{job.errorMessage}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {fmtTime(job.sentAt) !== '—' && (
          <span className="text-[10px] text-ink/40">{fmtTime(job.sentAt)}</span>
        )}
        {job.status === 'failed' && (
          <button
            type="button"
            onClick={() => onReprint(job._id)}
            className="flex items-center gap-1 rounded border border-border bg-mist px-2 py-0.5 text-[10px] font-medium text-ink/60 hover:bg-canvas"
          >
            <RotateCcw size={9} />
            Retry
          </button>
        )}
        {job.jobType === 'receipt' && job.status === 'success' && (
          <button
            type="button"
            onClick={() => onReprint(job._id)}
            className="flex items-center gap-1 rounded border border-border bg-mist px-2 py-0.5 text-[10px] font-medium text-ink/60 hover:bg-canvas"
          >
            <RotateCcw size={9} />
            Reprint
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PrinterPanel() {
  const [printers, setPrinters] = useState<PrinterDeviceStatus[]>([]);
  const [jobs, setJobs]         = useState<PrintJob[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [nowMs, setNowMs]       = useState(() => Date.now());
  const [_reprinting, setReprinting] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<'all' | 'failed' | 'receipt'>('all');

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    const [devRes, jobRes] = await Promise.allSettled([
      fetchPrinterDevices(),
      fetchReceiptJobs(),
    ]);
    if (!cancelled) {
      if (devRes.status === 'fulfilled') setPrinters(devRes.value);
      if (jobRes.status === 'fulfilled') setJobs(jobRes.value);
      if (devRes.status === 'rejected' && jobRes.status === 'rejected') {
        setError('Failed to load printer data');
      } else {
        setError(null);
      }
      setLoading(false);
      setNowMs(Date.now());
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); setNowMs(Date.now()); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleReprint(jobId: string) {
    setReprinting(jobId);
    try { await reprintJob(jobId); await load(); } catch { /* non-fatal */ } finally { setReprinting(null); }
  }

  const filteredJobs = jobs.filter(j => {
    if (jobFilter === 'failed') return j.status === 'failed';
    if (jobFilter === 'receipt') return j.jobType === 'receipt';
    return true;
  }).slice(0, 30);

  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Printer Management</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Printer devices */}
      {printers.length > 0 ? (
        <div className="space-y-2">
          {printers.map(p => <PrinterCard key={p._id} printer={p} nowMs={nowMs} />)}
        </div>
      ) : !loading ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center">
          <Printer size={20} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm text-ink/40">No printer devices registered</p>
        </div>
      ) : null}

      {/* Print jobs */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Print Queue</p>
            {failedCount > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                {failedCount} failed
              </span>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1">
            {(['all', 'receipt', 'failed'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setJobFilter(f)}
                className={`rounded-lg px-3 py-1 text-[11px] font-semibold capitalize transition ${
                  jobFilter === f ? 'bg-brand text-white' : 'border border-border text-ink/60 hover:bg-mist'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {filteredJobs.map(job => (
              <JobRow
                key={job._id}
                job={job}
                nowMs={nowMs}
                onReprint={id => void handleReprint(id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
