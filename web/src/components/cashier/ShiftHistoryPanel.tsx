import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../../context/SettingsContext';
import {
  History,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Clock,
  User,
} from 'lucide-react';
import { apiGetShiftHistory } from '../../api/shifts';
import type { ShiftData } from '../../api/shifts';
import { useCashier } from '../../context/CashierContext';
import { Spinner } from '../ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number, sym = '₹'): string {
  return `${sym}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Shift card ────────────────────────────────────────────────────────────────

interface ShiftCardProps {
  shift: ShiftData;
  onViewReport: (id: string) => void;
}

function ShiftCard({ shift, onViewReport }: ShiftCardProps) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const isOpen = shift.status === 'open';
  const diff = shift.difference ?? 0;

  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      {/* Top row: date + status badge */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-ink">
            <Clock size={13} className="text-ink/40" />
            <span className="text-sm font-semibold">{fmtDate(shift.openedAt)}</span>
          </div>
          {isOpen ? (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              Active
            </span>
          ) : (
            <p className="mt-0.5 text-xs text-ink/50">
              {fmtTime(shift.openedAt)}
              {shift.closedAt ? ` → ${fmtTime(shift.closedAt)}` : ''}
            </p>
          )}
        </div>

        <span
          className={`mt-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
            isOpen
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-border/60 text-ink/50'
          }`}
        >
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      {/* Cashier */}
      <div className="mb-3 flex items-center gap-1.5 text-xs text-ink/60">
        <User size={12} />
        <span>{shift.cashierName}</span>
      </div>

      {/* Cash figures or in-progress note */}
      {isOpen ? (
        <div className="rounded-lg border border-border bg-mist px-3 py-2">
          <p className="text-xs text-ink/50">Shift in progress</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-mist px-3 py-2.5 space-y-1.5">
          <CashRow label="Opening Cash" value={fmtINR(shift.openingCash, sym)} />
          <CashRow
            label="Expected Cash"
            value={fmtINR(shift.expectedCash ?? 0, sym)}
          />
          <CashRow
            label="Actual Cash"
            value={fmtINR(shift.actualCash ?? 0, sym)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink/55">Difference</span>
            <span
              className={`text-xs font-semibold ${
                diff > 0
                  ? 'text-emerald-600'
                  : diff < 0
                  ? 'text-red-500'
                  : 'text-ink/50'
              }`}
            >
              {diff > 0
                ? `+${fmtINR(diff, sym)}`
                : diff < 0
                ? `−${fmtINR(Math.abs(diff), sym)}`
                : fmtINR(0, sym)}
            </span>
          </div>
        </div>
      )}

      {/* View Z-Report button (closed only) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => onViewReport(shift._id)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-medium text-ink transition hover:bg-mist"
        >
          <FileText size={13} />
          View Z-Report
        </button>
      )}
    </div>
  );
}

function CashRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink/55">{label}</span>
      <span className="text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function ShiftHistoryPanel() {
  const { setActiveTab, setSelectedShiftId } = useCashier();

  const [shifts, setShifts] = useState<ShiftData[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetShiftHistory(p);
      setShifts(res.shifts);
      setTotalPages(res.pages);
      setPage(res.page);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shift history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  function handleViewReport(shiftId: string) {
    setSelectedShiftId(shiftId);
    setActiveTab('z-report');
  }

  function handlePrev() {
    if (page > 1) void load(page - 1);
  }

  function handleNext() {
    if (page < totalPages) void load(page + 1);
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{error}</p>
        <button
          type="button"
          onClick={() => void load(page)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist"
        >
          <RefreshCw size={13} />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────

  if (!loading && shifts.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-ink/40">
        <History size={28} />
        <p className="text-sm">No shift history yet</p>
      </div>
    );
  }

  // ── List ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">
          Shift History
        </h2>
        <button
          type="button"
          onClick={() => void load(page)}
          className="flex items-center gap-1 rounded-lg p-1.5 text-ink/40 transition hover:bg-mist hover:text-ink"
          aria-label="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {shifts.map(shift => (
          <ShiftCard
            key={shift._id}
            shift={shift}
            onViewReport={handleViewReport}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={handlePrev}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={13} />
            Prev
          </button>

          <span className="text-xs text-ink/50">
            Page {page} of {totalPages}
          </span>

          <button
            type="button"
            onClick={handleNext}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
