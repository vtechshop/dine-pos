import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { apiGetShift } from '../../api/shifts';
import type { ShiftData } from '../../api/shifts';
import { Spinner } from '../ui/Spinner';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ZReportViewProps {
  shiftId: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return `₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function fmtINRSigned(n: number): string {
  if (n < 0) return `−₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
  return `₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
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

function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

function computeDuration(openedAt: string, closedAt: string): string {
  const diffMs = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const totalMins = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
      {children}
    </p>
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink/55">{label}</span>
      <span className={`text-xs text-ink ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}

// ── Z-Report body (closed shift only) ────────────────────────────────────────

function ZReportBody({ shift }: { shift: ShiftData }) {
  const diff = shift.difference ?? 0;

  return (
    <>
      {/* Info card */}
      <div className="mb-4 rounded-xl border border-border bg-canvas p-4 space-y-2">
        <Row label="Cashier" value={shift.cashierName} />
        <Row label="Opened" value={fmtDateTime(shift.openedAt)} />
        {shift.closedAt && (
          <>
            <Row label="Closed" value={fmtDateTime(shift.closedAt)} />
            <Row
              label="Duration"
              value={computeDuration(shift.openedAt, shift.closedAt)}
            />
          </>
        )}
      </div>

      {/* Sales Summary */}
      <SectionHeader>Sales Summary</SectionHeader>
      <div className="mb-4 rounded-xl border border-border bg-canvas p-4 space-y-2">
        <Row label="Cash Sales" value={fmtINR(shift.cashSales)} />
        <Row label="UPI Sales" value={fmtINR(shift.upiSales)} />
        <Row label="Card Sales" value={fmtINR(shift.cardSales)} />
        <Row label="Other Sales" value={fmtINR(shift.otherSales)} />
        <div className="my-1 border-t border-border" />
        <Row label="Total Orders" value={String(shift.totalOrders)} />
        <Row label="Total Sales" value={fmtINR(shift.totalSales)} bold />
      </div>

      {/* Drawer Reconciliation */}
      <SectionHeader>Drawer Reconciliation</SectionHeader>
      <div className="mb-4 rounded-xl border border-border bg-canvas p-4 space-y-3">
        <div className="rounded-lg bg-mist px-3 py-2.5 font-mono text-xs text-ink space-y-1">
          <div className="flex justify-between">
            <span>Opening Cash:</span>
            <span>{fmtINR(shift.openingCash)}</span>
          </div>
          <div className="flex justify-between">
            <span>+ Cash Sales:</span>
            <span>{fmtINR(shift.cashSales)}</span>
          </div>
          <div className="flex justify-between">
            <span>+ Cash In:&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span>{fmtINR(shift.cashIn)}</span>
          </div>
          <div className="flex justify-between">
            <span>− Cash Out:&nbsp;&nbsp;&nbsp;</span>
            <span>{fmtINR(shift.cashOut)}</span>
          </div>
          <div className="mt-1 border-t border-border pt-1 flex justify-between font-semibold">
            <span>= Expected:&nbsp;&nbsp;&nbsp;</span>
            <span>{fmtINR(shift.expectedCash ?? 0)}</span>
          </div>
        </div>
        <Row label="Actual Cash" value={fmtINR(shift.actualCash ?? 0)} />
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
              ? `${fmtINRSigned(diff)} Excess`
              : diff < 0
              ? `${fmtINRSigned(diff)} Shortage`
              : `${fmtINR(0)} Balanced`}
          </span>
        </div>
      </div>

      {/* Drawer Movements */}
      <SectionHeader>Movements</SectionHeader>
      <div className="mb-4 rounded-xl border border-border bg-canvas p-4">
        {shift.movements.length === 0 ? (
          <p className="text-xs text-ink/50">No movements recorded</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 font-medium text-ink/50">Time</th>
                  <th className="pb-2 font-medium text-ink/50">Type</th>
                  <th className="pb-2 font-medium text-ink/50 text-right">Amount</th>
                  <th className="pb-2 font-medium text-ink/50">Reason</th>
                  <th className="pb-2 font-medium text-ink/50">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shift.movements.map(m => (
                  <tr key={m._id}>
                    <td className="py-2 text-ink/60">{fmtTime(m.timestamp)}</td>
                    <td className="py-2">
                      {m.type === 'cash_in' ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Cash In
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                          Cash Out
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium text-ink">
                      {fmtINR(m.amount)}
                    </td>
                    <td className="py-2 text-ink/70">{m.reason}</td>
                    <td className="py-2 text-ink/60">{m.cashierName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closing Note */}
      {shift.closingNote && (
        <>
          <SectionHeader>Closing Note</SectionHeader>
          <div className="mb-4 rounded-xl border border-border bg-canvas p-4">
            <p className="text-xs text-ink/70">{shift.closingNote}</p>
          </div>
        </>
      )}

      {/* Footer */}
      <p className="mt-2 text-center text-[10px] text-ink/40">
        Generated on {fmtDateTime(new Date().toISOString())}
      </p>
    </>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function ZReportView({ shiftId }: ZReportViewProps) {
  const [shift, setShift] = useState<ShiftData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!shiftId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGetShift(shiftId)
      .then(({ shift: s }) => {
        if (!cancelled) setShift(s);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load shift');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // retryCount triggers a re-fetch when Retry is clicked
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, retryCount]);

  // ── No shift selected ──────────────────────────────────────────────────────

  if (!shiftId) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-sm text-ink/50">No shift selected</p>
      </div>
    );
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
          onClick={() => setRetryCount(c => c + 1)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!shift) return null;

  // ── Shift still open ───────────────────────────────────────────────────────

  if (shift.status === 'open') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-sm font-medium text-amber-700">
          Shift is still open — Z-Report is available after close
        </p>
      </div>
    );
  }

  // ── Closed shift — full Z-Report ───────────────────────────────────────────

  return (
    <div>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #z-report-printable { display: block !important; position: fixed; top: 0; left: 0; width: 100%; background: white; padding: 24px; }
        }
      `}</style>

      <div id="z-report-printable">
        {/* Header row */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Z-Report</h2>
            <p className="text-xs text-ink/50">#{shift._id.slice(-8)}</p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist"
          >
            <Printer size={13} />
            Print
          </button>
        </div>

        <ZReportBody shift={shift} />
      </div>
    </div>
  );
}
