import { useState, useEffect, useCallback } from 'react';
import {
  Flame, CheckCircle, Clock, RefreshCw, AlertCircle,
  UtensilsCrossed, ChevronRight,
} from 'lucide-react';
import { fetchKitchenOrders } from '../../api/orders';
import { ApiError } from '../../api/client';
import { Spinner } from '../ui/Spinner';
import type { KDSOrder } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(iso: string, nowMs: number): { text: string; isDelayed: boolean } {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  const isDelayed = mins >= 20;
  if (mins < 1) return { text: 'Just now', isDelayed: false };
  if (mins < 60) return { text: `${mins}m`, isDelayed };
  return { text: `${Math.floor(mins / 60)}h ${mins % 60}m`, isDelayed };
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<KDSOrder['status'], {
  label: string; bg: string; border: string; text: string; icon: React.ReactNode
}> = {
  pending: {
    label: 'Pending',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: <Clock size={12} className="text-amber-600" />,
  },
  preparing: {
    label: 'Preparing',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: <Flame size={12} className="text-blue-600" />,
  },
  ready: {
    label: 'Ready',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
    icon: <CheckCircle size={12} className="text-emerald-600" />,
  },
};

// ── Summary chip ──────────────────────────────────────────────────────────────

function SummaryChip({
  count, label, bg, border, text, icon,
}: {
  count: number; label: string; bg: string; border: string; text: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border ${border} ${bg} px-4 py-3`}>
      {icon}
      <div>
        <p className={`text-2xl font-bold leading-none ${text}`}>{count}</p>
        <p className={`text-[10px] font-medium uppercase tracking-wide ${text} opacity-70`}>{label}</p>
      </div>
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

function KitchenCard({ order, nowMs }: { order: KDSOrder; nowMs: number }) {
  const cfg = STATUS_CFG[order.status] ?? STATUS_CFG['pending'];
  const { text: ageText, isDelayed } = fmtAge(order.createdAt, nowMs);

  return (
    <div className={`rounded-xl border p-3 ${cfg.border} ${cfg.bg} ${isDelayed ? 'ring-1 ring-red-300' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {cfg.icon}
          <div>
            <p className={`text-xs font-bold ${cfg.text}`}>#{order.orderNumber}</p>
            <p className="text-[10px] text-ink/50">
              {order.tableNumber ? `Table ${order.tableNumber}` :
               order.customerName ? order.customerName :
               order.isParcel ? 'Takeaway' : 'Walk-in'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${isDelayed ? 'text-red-600' : 'text-ink/50'}`}>
            <Clock size={9} />
            {ageText}
          </span>
          {isDelayed && (
            <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold uppercase text-red-700">
              Delayed
            </span>
          )}
        </div>
      </div>

      {/* Item list */}
      <div className="mt-2 space-y-0.5">
        {order.items.slice(0, 5).map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-ink/75">
            <span className="font-semibold text-ink/50">{item.quantity}×</span>
            <span className="truncate">{item.productName}</span>
          </div>
        ))}
        {order.items.length > 5 && (
          <p className="text-[10px] text-ink/45">+{order.items.length - 5} more items</p>
        )}
      </div>

      {/* Notes */}
      {order.notes && (
        <p className="mt-1.5 rounded bg-white/60 px-2 py-1 text-[10px] text-ink/60 italic">
          {order.notes}
        </p>
      )}

      {/* Status badge */}
      <div className="mt-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${cfg.border} ${cfg.text}`}>
          {cfg.icon}
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | KDSOrder['status'];

export function KitchenStatusPanel() {
  const [orders, setOrders]         = useState<KDSOrder[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [nowMs, setNowMs]           = useState(() => Date.now());
  const [filter, setFilter]         = useState<FilterTab>('all');

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const data = await fetchKitchenOrders();
      if (!cancelled) { setOrders(data); setError(null); setAccessDenied(false); }
    } catch (e) {
      if (!cancelled) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
          setAccessDenied(true);
          setError(null);
          setOrders([]);
        } else {
          setError('Failed to load kitchen orders');
        }
      }
    } finally {
      if (!cancelled) { setLoading(false); setNowMs(Date.now()); }
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  const pendingCount   = orders.filter(o => o.status === 'pending').length;
  const preparingCount = orders.filter(o => o.status === 'preparing').length;
  const readyCount     = orders.filter(o => o.status === 'ready').length;
  const delayedCount   = orders.filter(o => {
    if (o.status === 'ready') return false;
    return (nowMs - new Date(o.createdAt).getTime()) / 60_000 >= 20;
  }).length;

  const filtered = filter === 'all'
    ? orders
    : orders.filter(o => o.status === filter);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Kitchen Status</h2>
        <div className="flex items-center gap-2">
          {delayedCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700">
              <AlertCircle size={11} />
              {delayedCount} delayed
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist disabled:opacity-50"
          >
            {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryChip
          count={pendingCount}
          label="Pending"
          bg="bg-amber-50"
          border="border-amber-200"
          text="text-amber-800"
          icon={<Clock size={18} className="text-amber-500" />}
        />
        <SummaryChip
          count={preparingCount}
          label="Preparing"
          bg="bg-blue-50"
          border="border-blue-200"
          text="text-blue-800"
          icon={<Flame size={18} className="text-blue-500" />}
        />
        <SummaryChip
          count={readyCount}
          label="Ready"
          bg="bg-emerald-50"
          border="border-emerald-200"
          text="text-emerald-800"
          icon={<CheckCircle size={18} className="text-emerald-500" />}
        />
      </div>

      {/* Access-denied graceful fallback — never show "Access Denied" */}
      {accessDenied && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <UtensilsCrossed size={16} className="shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Kitchen view not available</p>
            <p className="text-[11px] text-amber-700/80 mt-0.5">
              Your role does not have kitchen access. Contact your manager to enable it.
              The summary above reflects live data when accessible.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !accessDenied && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'pending', 'preparing', 'ready'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition ${
              filter === tab ? 'bg-brand text-white' : 'border border-border text-ink/60 hover:bg-mist'
            }`}
          >
            {tab === 'all' ? `All (${orders.length})` :
             tab === 'pending' ? `Pending (${pendingCount})` :
             tab === 'preparing' ? `Preparing (${preparingCount})` :
             `Ready (${readyCount})`}
          </button>
        ))}
      </div>

      {/* Order grid */}
      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <UtensilsCrossed size={22} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm text-ink/40">
            {filter === 'all' ? 'No active kitchen orders' : `No ${filter} orders`}
          </p>
          {filter === 'all' && (
            <p className="text-xs text-ink/30 mt-1">Kitchen is all clear</p>
          )}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(o => (
            <KitchenCard key={o._id} order={o} nowMs={nowMs} />
          ))}
        </div>
      )}

      {/* Note: read-only view */}
      <div className="rounded-xl border border-border bg-mist px-4 py-3">
        <div className="flex items-center gap-2">
          <ChevronRight size={12} className="text-ink/35" />
          <p className="text-[11px] text-ink/50">
            This is a read-only kitchen status view. To manage kitchen orders, go to the Kitchen display.
            Refreshes every 30 seconds automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
