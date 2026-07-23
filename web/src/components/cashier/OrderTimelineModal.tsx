import { X, CheckCircle, Circle, Info } from 'lucide-react';
import type { CashierOrderItem } from '../../api/orders';

// ── Step definitions ──────────────────────────────────────────────────────────

interface TimelineStep {
  key: string;
  label: string;
  doneStatuses: string[];
}

const STEPS: TimelineStep[] = [
  { key: 'created',   label: 'Order Created',   doneStatuses: ['pending', 'accepted', 'preparing', 'ready', 'served', 'paid', 'completed', 'cancelled'] },
  { key: 'accepted',  label: 'Accepted',         doneStatuses: ['accepted', 'preparing', 'ready', 'served', 'paid', 'completed'] },
  { key: 'preparing', label: 'Preparing',        doneStatuses: ['preparing', 'ready', 'served', 'paid', 'completed'] },
  { key: 'ready',     label: 'Ready to Serve',   doneStatuses: ['ready', 'served', 'paid', 'completed'] },
  { key: 'served',    label: 'Served',            doneStatuses: ['served', 'paid', 'completed'] },
  { key: 'paid',      label: 'Payment Taken',    doneStatuses: ['paid', 'completed'] },
  { key: 'completed', label: 'Completed',        doneStatuses: ['completed'] },
];

// ── Real timestamps we can show ───────────────────────────────────────────────

function getTimestamp(step: string, order: CashierOrderItem): string | null {
  if (step === 'created')   return order.createdAt;
  if (step === 'completed' || step === 'paid') return order.completedAt ?? null;
  return null;
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OrderTimelineModalProps {
  order: CashierOrderItem;
  onClose: () => void;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function OrderTimelineModal({ order, onClose }: OrderTimelineModalProps) {
  const isCancelled = order.status === 'cancelled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div>
            <p className="text-sm font-bold text-ink">Order Timeline</p>
            <p className="text-xs text-ink/50">
              #{order.orderNumber}
              {order.tableNumber ? ` · Table ${order.tableNumber}` : ''}
              {order.customerName ? ` · ${order.customerName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {/* Date */}
          <p className="text-[10px] text-ink/40 mb-3">{fmtDate(order.createdAt)}</p>

          {/* Cancelled banner */}
          {isCancelled && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-600">Order Cancelled</p>
            </div>
          )}

          {/* Steps */}
          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

            <div className="space-y-4">
              {STEPS.map((step, idx) => {
                const isDone = step.doneStatuses.includes(order.status);
                const isCurrent = !isDone && STEPS[idx - 1]?.doneStatuses.includes(order.status);
                const ts = getTimestamp(step.key, order);

                return (
                  <div key={step.key} className="relative flex items-start gap-3 pl-1">
                    {/* Dot */}
                    <div className={`relative z-10 mt-0.5 shrink-0 rounded-full ${
                      isDone
                        ? 'text-emerald-600'
                        : isCurrent
                        ? 'text-brand'
                        : 'text-ink/25'
                    }`}>
                      {isDone
                        ? <CheckCircle size={22} className="fill-emerald-50" />
                        : <Circle size={22} className={isCurrent ? 'fill-brand/10' : 'fill-canvas'} />
                      }
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-sm font-semibold ${
                          isDone ? 'text-ink' : isCurrent ? 'text-brand' : 'text-ink/30'
                        }`}>
                          {step.label}
                        </p>
                        <p className={`shrink-0 font-mono text-[11px] tabular-nums ${
                          ts ? 'text-ink/60' : 'text-ink/25'
                        }`}>
                          {fmtTs(ts)}
                        </p>
                      </div>
                      {isCurrent && (
                        <p className="text-[10px] text-brand/70 mt-0.5">Current status</p>
                      )}
                      {!isDone && !isCurrent && step.key !== 'created' && (
                        <p className="text-[10px] text-ink/25 mt-0.5">Not yet</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Backend gap note */}
          <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-2.5 flex items-start gap-2">
            <Info size={11} className="shrink-0 mt-0.5 text-ink/35" />
            <p className="text-[10px] text-ink/40 leading-relaxed">
              Only Created and Completed timestamps are available from the current API.
              Full per-step timestamps require a <code className="bg-mist rounded px-0.5">statusHistory[]</code> field
              in <code className="bg-mist rounded px-0.5">GET /orders/:id</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
