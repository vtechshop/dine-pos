import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:    string;
  value:    string | number;
  sub?:     string;
  accent?:  boolean;
  icon?:    ReactNode;
}

export function StatCard({ label, value, sub, accent, icon }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${accent ? 'bg-[#E8380D] border-[#C42F08] text-white' : 'bg-white border-[#E8D5C0]'}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wide ${accent ? 'text-orange-100' : 'text-[#92745E]'}`}>{label}</span>
        {icon && <span className={accent ? 'text-orange-200' : 'text-[#C4A090]'}>{icon}</span>}
      </div>
      <span className={`text-2xl font-black ${accent ? 'text-white' : 'text-[#1C0800]'}`}>{value}</span>
      {sub && <span className={`text-xs ${accent ? 'text-orange-100' : 'text-[#92745E]'}`}>{sub}</span>}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

type BadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'gray';

const BADGE: Record<BadgeVariant, string> = {
  green: 'bg-green-100 text-green-800 border-green-200',
  red:   'bg-red-100 text-red-800 border-red-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  blue:  'bg-blue-100 text-blue-800 border-blue-200',
  gray:  'bg-gray-100 text-gray-700 border-gray-200',
};

export function Badge({ label, variant = 'gray' }: { label: string; variant?: BadgeVariant }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-700 border ${BADGE[variant]}`}>
      {label}
    </span>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ className = 'h-8 w-8 text-[#E8380D]' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <span className="text-4xl opacity-30">{icon ?? '📭'}</span>
      <p className="font-bold text-[#1C0800]">{title}</p>
      {sub && <p className="text-sm text-[#92745E]">{sub}</p>}
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <p className="font-semibold text-red-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm text-[#E8380D] hover:underline font-semibold">
          Retry
        </button>
      )}
    </div>
  );
}

// ── API required banner ───────────────────────────────────────────────────────

export function ApiRequired({ endpoints }: { endpoints: string[] }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-amber-800 text-sm">Backend endpoint required</p>
          <p className="text-xs text-amber-700 mt-1 mb-2">
            This feature is disabled until the following API endpoints are implemented:
          </p>
          <ul className="space-y-1">
            {endpoints.map(ep => (
              <li key={ep} className="text-xs font-mono bg-amber-100 text-amber-900 px-2 py-1 rounded border border-amber-200">
                {ep}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-black text-[#1C0800]">{title}</h1>
        {sub && <p className="text-sm text-[#92745E] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function Table({
  columns,
  rows,
}: {
  columns: string[];
  rows:    ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E8D5C0]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
            {columns.map(c => (
              <th key={c} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE] transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-[#1C0800]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?:    'sm' | 'md';
  loading?: boolean;
}

const BTN: Record<string, string> = {
  primary:   'bg-[#E8380D] text-white hover:bg-[#C42F08] border-transparent',
  secondary: 'bg-white text-[#1C0800] hover:bg-[#FFF6EE] border-[#E8D5C0]',
  danger:    'bg-red-600 text-white hover:bg-red-700 border-transparent',
  ghost:     'bg-transparent text-[#92745E] hover:text-[#1C0800] hover:bg-[#FFF6EE] border-transparent',
};

export function Btn({ variant = 'secondary', size = 'md', loading, children, className = '', disabled, ...props }: BtnProps) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 font-semibold rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sz} ${BTN[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, wide }: {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  children: ReactNode;
  wide?:    boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-6 border-b border-[#E8D5C0] sticky top-0 bg-white z-10">
          <h2 className="text-lg font-black text-[#1C0800]">{title}</h2>
          <button onClick={onClose} className="text-[#92745E] hover:text-[#1C0800] text-xl font-bold leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const { label, error, className = '', ...rest } = props;
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">{label}</label>}
      <input
        {...rest}
        className={`w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D] ${className}`}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const { label, className = '', children, ...rest } = props;
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">{label}</label>}
      <select
        {...rest}
        className={`w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D] bg-white ${className}`}
      >
        {children}
      </select>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-[#E8380D]' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}
