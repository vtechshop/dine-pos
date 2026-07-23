// Shared UI primitives for Super Admin aggregator pages
// Uses DS v2 tokens: bg-canvas, bg-mist, border-border, text-ink, text-brand, bg-brand/10

import { type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// ── ApiRequired ────────────────────────────────────────────────────────────────

export function ApiRequired({ endpoints }: { endpoints: string[] }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs font-semibold text-amber-800">
          Backend endpoints required — feature unavailable until implemented
        </p>
      </div>
      <ul className="space-y-1">
        {endpoints.map(ep => (
          <li key={ep} className="font-mono text-[11px] bg-amber-100 text-amber-900 px-2 py-1 rounded">
            {ep}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── SAStat ─────────────────────────────────────────────────────────────────────

interface SAStatProps {
  label:   string;
  value:   string | number;
  sub?:    string;
  accent?: boolean;
  icon?:   ReactNode;
  warn?:   boolean;
}

export function SAStat({ label, value, sub, accent, icon, warn }: SAStatProps) {
  return (
    <div className={`rounded-xl border p-4 ${
      warn   ? 'border-red-200 bg-red-50' :
      accent ? 'border-brand/20 bg-brand/5' :
               'border-border bg-canvas'
    }`}>
      {icon && <div className={`mb-2 ${accent ? 'text-brand' : warn ? 'text-red-500' : 'text-ink/40'}`}>{icon}</div>}
      <p className={`text-2xl font-black tabular-nums ${
        accent ? 'text-brand' : warn ? 'text-red-600' : 'text-ink'
      }`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-ink/60">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink/40">{sub}</p>}
    </div>
  );
}

// ── SABadge ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'brand';

export function SABadge({ label, variant = 'gray' }: { label: string; variant?: BadgeVariant }) {
  const cls: Record<BadgeVariant, string> = {
    green:  'bg-green-50 text-green-700 border-green-200',
    red:    'bg-red-50 text-red-700 border-red-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    gray:   'bg-gray-100 text-gray-600 border-gray-200',
    brand:  'bg-brand/10 text-brand border-brand/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls[variant]}`}>
      {label}
    </span>
  );
}

// ── SAPageHeader ───────────────────────────────────────────────────────────────

export function SAPageHeader({
  title, sub, action, onRefresh, refreshing,
}: {
  title:       string;
  sub?:        string;
  action?:     ReactNode;
  onRefresh?:  () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex items-start justify-between border-b border-border bg-canvas px-8 py-6">
      <div>
        <h1 className="text-xl font-black text-ink">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink/50">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        {action}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-2 text-sm font-medium text-ink/70 hover:bg-mist disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

// ── SATable ────────────────────────────────────────────────────────────────────

export function SATable<T>({
  cols, rows, rowKey, renderRow, emptyText,
}: {
  cols:      string[];
  rows:      T[];
  rowKey:    (row: T) => string;
  renderRow: (row: T) => ReactNode;
  emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-mist">
            {cols.map(c => (
              <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-4 py-8 text-center text-sm text-ink/40">
                {emptyText ?? 'No data'}
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr key={rowKey(row)} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                {renderRow(row)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Spinner ─────────────────────────────────────────────────────────────────────

export function SASpin() {
  return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw size={24} className="animate-spin text-brand/40" />
    </div>
  );
}

// ── Error state ────────────────────────────────────────────────────────────────

export function SAError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <AlertTriangle size={32} className="text-red-400" />
      <p className="text-sm font-semibold text-red-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/70 hover:bg-mist">
          Try again
        </button>
      )}
    </div>
  );
}

// ── fmtINR ─────────────────────────────────────────────────────────────────────

export function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
