import { useState, type FormEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Spinner } from '../ui/Spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditActionPayload {
  reason: string;
  cashierName: string;
  cashierId: string;
  timestamp: string;
}

interface AuditModalProps {
  title: string;
  description: string;
  actionLabel: string;
  danger?: boolean;
  cashierName: string;
  cashierId: string;
  onConfirm: (payload: AuditActionPayload) => Promise<void>;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditModal({
  title,
  description,
  actionLabel,
  danger = false,
  cashierName,
  cashierId,
  onConfirm,
  onClose,
}: AuditModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError('Reason is required'); return; }
    setError(null);
    setLoading(true);
    try {
      await onConfirm({
        reason: reason.trim(),
        cashierName,
        cashierId,
        timestamp: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className={`mt-0.5 rounded-lg p-1.5 ${danger ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}>
            <AlertTriangle size={16} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mt-0.5 text-xs text-ink/55">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink/40 hover:bg-mist hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Audit context — read-only */}
          <div className="rounded-lg border border-border bg-mist px-3 py-2.5 space-y-1">
            <Row label="Cashier" value={cashierName} />
            <Row label="ID" value={cashierId} />
            <Row label="Time" value={new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
          </div>

          {/* Reason */}
          <div>
            <label htmlFor="audit-reason" className="block text-xs font-medium text-ink/70">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="audit-reason"
              rows={2}
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Enter reason for this action…"
              className="mt-1.5 block w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-ink placeholder-ink/35 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink/70 hover:bg-mist"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand hover:bg-brand/90'
              }`}
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Processing…' : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink/50">{label}</span>
      <span className="text-[11px] font-medium text-ink">{value}</span>
    </div>
  );
}
