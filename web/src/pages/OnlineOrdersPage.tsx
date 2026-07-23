import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, AlertCircle, Check, X, Printer,
  Clock, MapPin, Phone, User, ShoppingBag,
  Bell, MessageCircle, Navigation, Copy, Timer,
  ChevronDown, ChevronUp, CheckCircle, Truck, Bike,
} from 'lucide-react';
import {
  fetchOnlineOrders,
  acceptDeliveryOrder,
  rejectDeliveryOrder,
  dispatchDeliveryOrder,
} from '../api/aggregator';
import type { OnlineOrder, AggregatorPlatform } from '../api/aggregator';
import { Spinner } from '../components/ui/Spinner';
import { useSocket } from '../context/SocketContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtElapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ${mins % 60}m ago` : `${Math.floor(hrs / 24)}d ago`;
}

function elapsedMins(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

// ── Sound ─────────────────────────────────────────────────────────────────────

function playNewOrderSound() {
  try {
    const ctx = new AudioContext();
    const beep = (t: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
      gain.gain.setValueAtTime(0.4, t + 0.12);
      gain.gain.linearRampToValueAtTime(0, t + 0.18);
      osc.start(t); osc.stop(t + 0.2);
    };
    beep(ctx.currentTime); beep(ctx.currentTime + 0.25); beep(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 1200);
  } catch { /* unavailable */ }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast { id: number; type: 'success' | 'error' | 'info'; message: string }
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_tid;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-md text-sm font-medium ${
          t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {t.type === 'success' ? <Check size={14} /> : t.type === 'error' ? <AlertCircle size={14} /> : <Bell size={14} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Delay severity ────────────────────────────────────────────────────────────

type DelaySev = 'none' | 'slow' | 'late' | 'critical';

function delaySeverity(order: OnlineOrder): DelaySev {
  if (order.status !== 'pending' && order.status !== 'preparing') return 'none';
  const mins = elapsedMins(order.createdAt);
  if (mins >= 45) return 'critical';
  if (mins >= 30) return 'late';
  if (mins >= 20) return 'slow';
  return 'none';
}

const SEV_BORDER: Record<DelaySev, string> = {
  none:     'border-border',
  slow:     'border-amber-300 ring-1 ring-amber-100',
  late:     'border-red-300 ring-1 ring-red-100',
  critical: 'border-red-500 ring-2 ring-red-200',
};

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: OnlineOrder['orderSource'] }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
      source === 'swiggy' ? 'bg-brand' : 'bg-red-600'
    }`}>
      {source === 'swiggy' ? <Bike size={9} /> : <Truck size={9} />}
      {source.toUpperCase()}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<OnlineOrder['status'], { label: string; cls: string }> = {
  pending:   { label: 'Pending',    cls: 'bg-amber-50 border-amber-200 text-amber-700' },
  preparing: { label: 'In Kitchen', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
  ready:     { label: 'Ready',      cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  served:    { label: 'Served',     cls: 'bg-purple-50 border-purple-200 text-purple-700' },
  completed: { label: 'Completed',  cls: 'bg-green-50 border-green-200 text-green-700' },
  cancelled: { label: 'Cancelled',  cls: 'bg-gray-50 border-gray-200 text-gray-500' },
};

function StatusBadge({ status }: { status: OnlineOrder['status'] }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-50 border-gray-200 text-gray-500' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── ETA picker ────────────────────────────────────────────────────────────────

const ETA_PRESETS = [10, 15, 20, 30, 45, 60];

function EtaPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const isPreset = ETA_PRESETS.includes(value);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-ink/50">Preparation time</p>
      <div className="flex flex-wrap gap-1.5">
        {ETA_PRESETS.map(m => (
          <button key={m} type="button" onClick={() => onChange(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              value === m && isPreset ? 'bg-brand text-white' : 'border border-border text-ink/60 hover:border-brand hover:text-brand'
            }`}>
            {m} min
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="number" min={5} max={120}
            value={!isPreset ? value : ''}
            placeholder="Custom"
            onChange={e => { const v = Number(e.target.value); if (v >= 5 && v <= 120) onChange(v); }}
            className={`w-20 rounded-lg border px-2 py-1.5 text-xs text-center focus:outline-none ${
              !isPreset ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-mist text-ink/40'
            } focus:border-brand`}
            title="Custom minutes"
          />
          <span className="text-xs text-ink/40">min</span>
        </div>
      </div>
    </div>
  );
}

// ── Reject presets ────────────────────────────────────────────────────────────

const REJECT_PRESETS = [
  'Restaurant is busy',
  'Temporarily closed',
  'Item(s) unavailable',
  'Cannot deliver to address',
  'Order amount too low',
];

function RejectForm({ onConfirm, onCancel, busy }: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-xs font-semibold text-red-800">Rejection reason</p>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_PRESETS.map(p => (
          <button key={p} type="button" onClick={() => setReason(p)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              reason === p ? 'border-red-400 bg-red-600 text-white' : 'border-red-200 bg-white text-red-700 hover:bg-red-100'
            }`}>
            {p}
          </button>
        ))}
      </div>
      <input type="text" value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Or type a custom reason…"
        className="w-full rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-red-400 focus:outline-none"
      />
      <div className="flex gap-2">
        <button type="button" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? <Spinner size="sm" /> : <X size={11} />}
          Reject Order
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Payment breakdown ─────────────────────────────────────────────────────────

function PaymentBreakdown({ order }: { order: OnlineOrder }) {
  const tax        = order.taxTotal          ?? 0;
  const discount   = order.discountAmount    ?? 0;
  const commission = order.platformCommission ?? 0;
  const netSettle  = order.grandTotal - commission;
  const subtotal   = order.subtotal ?? (order.grandTotal - tax + discount - order.deliveryFee);
  return (
    <div className="rounded-xl border border-border bg-mist/30 p-3 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Payment breakdown</p>
      {subtotal > 0 && (
        <div className="flex justify-between text-sm text-ink/60"><span>Subtotal</span><span>{fmtINR(subtotal)}</span></div>
      )}
      {tax > 0 && (
        <div className="flex justify-between text-sm text-ink/60"><span>Tax</span><span>{fmtINR(tax)}</span></div>
      )}
      {order.deliveryFee > 0 && (
        <div className="flex justify-between text-sm text-ink/60"><span>Delivery fee</span><span>{fmtINR(order.deliveryFee)}</span></div>
      )}
      {discount > 0 && (
        <div className="flex justify-between text-sm text-emerald-700"><span>Discount</span><span>-{fmtINR(discount)}</span></div>
      )}
      <div className="flex justify-between text-sm font-bold text-ink border-t border-border pt-1 mt-1">
        <span>Grand Total</span><span>{fmtINR(order.grandTotal)}</span>
      </div>
      {commission > 0 && (
        <>
          <div className="flex justify-between text-sm text-red-600">
            <span>{order.orderSource === 'swiggy' ? 'Swiggy' : 'Zomato'} commission</span>
            <span>-{fmtINR(commission)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-emerald-700 border-t border-border pt-1 mt-1">
            <span>Net to restaurant</span><span>{fmtINR(netSettle)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Order timeline ────────────────────────────────────────────────────────────

function OrderTimeline({ order }: { order: OnlineOrder }) {
  const events: { label: string; time: string | null; done: boolean }[] = [
    { label: 'Order placed', time: order.createdAt, done: true },
  ];
  if (order.status === 'cancelled') {
    events.push({ label: 'Accepted', time: null, done: false });
    events.push({ label: `Rejected${order.rejectionReason ? `: ${order.rejectionReason}` : ''}`, time: order.rejectedAt, done: !!order.rejectedAt });
  } else {
    const accepted = !!order.acceptedAt;
    events.push({ label: accepted ? 'Accepted by cashier' : 'Awaiting acceptance', time: order.acceptedAt, done: accepted });
    const inKitchen = ['preparing', 'ready', 'served', 'completed'].includes(order.status);
    events.push({ label: 'Sent to kitchen', time: accepted ? order.acceptedAt : null, done: accepted && inKitchen });
    const isReady = ['ready', 'served', 'completed'].includes(order.status);
    events.push({ label: 'Ready for pickup', time: null, done: isReady });
    events.push({ label: 'Order dispatched', time: null, done: order.status === 'served' || order.status === 'completed' });
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Order timeline</p>
      <div className="space-y-2 pl-5 relative">
        {events.map((ev, i) => (
          <div key={i} className="relative flex items-start gap-3">
            <span className={`absolute -left-4 mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
              ev.done ? 'border-brand bg-brand' : 'border-border bg-canvas'
            }`}>
              {ev.done && <Check size={7} className="text-white" />}
            </span>
            <div>
              <p className={`text-sm font-medium ${ev.done ? 'text-ink' : 'text-ink/30'}`}>{ev.label}</p>
              {ev.time && <p className="text-xs text-ink/40">{fmtTime(ev.time)}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Customer actions ──────────────────────────────────────────────────────────

function CustomerActions({ order, onCopied }: { order: OnlineOrder; onCopied: () => void }) {
  const phone   = order.customerPhone;
  const address = order.deliveryAddress;
  const mapsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const waUrl   = phone   ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, your ${order.orderSource} order #${order.orderNumber} is confirmed!`)}` : null;
  return (
    <div className="flex flex-wrap gap-2">
      {phone && (
        <a href={`tel:${phone}`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink">
          <Phone size={12} /> Call Customer
        </a>
      )}
      {waUrl && (
        <a href={waUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
          <MessageCircle size={12} /> WhatsApp
        </a>
      )}
      {address && (
        <button type="button" onClick={() => { copyToClipboard(address); onCopied(); }}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink">
          <Copy size={12} /> Copy Address
        </button>
      )}
      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          <Navigation size={12} /> Open Maps
        </a>
      )}
    </div>
  );
}

// ── Print helper ──────────────────────────────────────────────────────────────

function printOrder(order: OnlineOrder) {
  const win = window.open('', '_blank', 'width=400,height=600');
  if (!win) return;
  win.document.write(`
    <html><head><title>Order ${order.orderNumber}</title>
    <style>
      body { font-family: monospace; font-size: 13px; padding: 16px; }
      h2 { font-size: 16px; margin: 0 0 8px; }
      hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; }
      .bold { font-weight: bold; }
      .muted { color: #666; font-size: 11px; }
    </style></head><body>
    <h2>${order.orderSource.toUpperCase()} ORDER</h2>
    <p>${order.orderNumber} &bull; ${fmtTime(order.createdAt)}</p>
    <hr/>
    <p class="bold">${order.customerName}</p>
    <p class="muted">${order.customerPhone}</p>
    <p class="muted">${order.deliveryAddress}</p>
    <hr/>
    ${order.items.map(i => `<div class="row"><span>${i.productName} x${i.quantity}</span><span>&#8377;${Math.round(i.total)}</span></div>`).join('')}
    <hr/>
    ${order.deliveryFee > 0 ? `<div class="row muted"><span>Delivery fee</span><span>&#8377;${Math.round(order.deliveryFee)}</span></div>` : ''}
    <div class="row bold"><span>Grand Total</span><span>&#8377;${Math.round(order.grandTotal)}</span></div>
    ${order.notes ? `<p class="muted" style="margin-top:8px">Note: ${order.notes}</p>` : ''}
    </body></html>
  `);
  win.document.close(); win.focus(); win.print();
}

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatsRow({ orders }: { orders: OnlineOrder[] }) {
  const today       = todayStr();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toLocaleDateString('en-CA') === today);
  const active      = todayOrders.filter(o => o.status !== 'cancelled');
  const revenue     = active.reduce((s, o) => s + o.grandTotal, 0);
  const pending     = orders.filter(o => o.status === 'pending').length;
  const kitchen     = orders.filter(o => o.status === 'preparing').length;
  const avg         = active.length > 0 ? revenue / active.length : 0;

  const chips = [
    { label: "Today's Orders", value: String(todayOrders.length), cls: 'border-brand/20 bg-brand/5 text-brand' },
    { label: 'Revenue',        value: fmtINR(revenue),            cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { label: 'Pending',        value: String(pending),            cls: pending > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-canvas text-ink/50' },
    { label: 'In Kitchen',     value: String(kitchen),            cls: kitchen > 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-border bg-canvas text-ink/50' },
    { label: 'Avg Order',      value: fmtINR(avg),                cls: 'border-border bg-canvas text-ink/60' },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {chips.map(c => (
        <div key={c.label} className={`flex flex-col rounded-xl border px-4 py-2.5 ${c.cls}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{c.label}</span>
          <span className="text-lg font-bold leading-tight">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onAccepted,
  onRejected,
  onDispatched,
  onToast,
}: {
  order: OnlineOrder;
  onAccepted: (id: string) => void;
  onRejected: (id: string) => void;
  onDispatched: (id: string) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}) {
  const [busy,       setBusy]       = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [prepMin,    setPrepMin]    = useState(20);
  const [expanded,   setExpanded]   = useState(false);

  const sev = delaySeverity(order);

  async function handleAccept() {
    setBusy('accept');
    try {
      await acceptDeliveryOrder(order._id, prepMin);
      onAccepted(order._id);
      onToast('success', `Order ${order.orderNumber} accepted (${prepMin}m ETA).`);
      setShowAccept(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to accept');
    } finally { setBusy(null); }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    try {
      await rejectDeliveryOrder(order._id, reason);
      onRejected(order._id);
      onToast('success', `Order ${order.orderNumber} rejected.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(null); setShowReject(false); }
  }

  async function handleDispatch() {
    setBusy('dispatch');
    try {
      await dispatchDeliveryOrder(order._id);
      onDispatched(order._id);
      onToast('success', `Order ${order.orderNumber} updated.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to dispatch');
    } finally { setBusy(null); }
  }

  return (
    <div className={`rounded-2xl border bg-canvas shadow-sm ${SEV_BORDER[sev]}`}>
      {/* Card header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PlatformBadge source={order.orderSource} />
          <span className="font-mono text-sm font-bold text-ink">{order.orderNumber}</span>
          <StatusBadge status={order.status} />
          {sev !== 'none' && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              sev === 'critical' ? 'bg-red-600 text-white animate-pulse'
              : sev === 'late' ? 'bg-red-100 border border-red-300 text-red-700'
              : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <Timer size={9} />
              {sev === 'critical' ? 'CRITICAL' : sev === 'late' ? 'LATE' : 'SLOW'} {elapsedMins(order.createdAt)}m
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1 text-xs text-ink/50">
          <Clock size={11} />
          {fmtElapsed(order.createdAt)}
        </div>
      </div>

      {/* Customer info */}
      <div className="border-b border-border px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-ink">
          <User size={13} className="text-ink/40 shrink-0" />
          <span className="font-medium">{order.customerName}</span>
        </div>
        {order.customerPhone && (
          <div className="flex items-center gap-2 text-xs text-ink/60">
            <Phone size={11} className="shrink-0 text-ink/35" />
            <a href={`tel:${order.customerPhone}`} className="text-brand hover:underline">{order.customerPhone}</a>
          </div>
        )}
        {order.deliveryAddress && (
          <div className="flex items-start gap-2 text-xs text-ink/60">
            <MapPin size={11} className="mt-0.5 shrink-0 text-ink/35" />
            <span className="line-clamp-2">{order.deliveryAddress}</span>
          </div>
        )}
        {order.estimatedPickupTime && (
          <div className="flex items-center gap-1 text-xs text-blue-600">
            <Clock size={11} /> ETA: {fmtTime(order.estimatedPickupTime)}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="border-b border-border px-4 py-3 space-y-1">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-ink/80">{item.productName} <span className="text-ink/40">×{item.quantity}</span></span>
            <span className="font-medium text-ink">{fmtINR(item.total)}</span>
          </div>
        ))}
        {order.notes && (
          <p className="mt-1 text-xs italic text-ink/50">Note: {order.notes}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-bold text-ink">{fmtINR(order.grandTotal)}</p>
            {order.deliveryFee > 0 && (
              <p className="text-xs text-ink/40">incl. {fmtINR(order.deliveryFee)} delivery</p>
            )}
          </div>
          <span className="font-mono text-[10px] text-ink/30">{order.platformOrderId}</span>
        </div>

        {showAccept && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3">
            <EtaPicker value={prepMin} onChange={setPrepMin} />
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleAccept()} disabled={busy === 'accept'}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'accept' ? <Spinner size="sm" /> : <CheckCircle size={12} />}
                Confirm ({prepMin}m)
              </button>
              <button type="button" onClick={() => setShowAccept(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink/60 hover:bg-mist">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {order.status === 'pending' && !showAccept && (
            <>
              <button type="button" onClick={() => { setShowAccept(true); setShowReject(false); }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                <Check size={12} /> Accept
              </button>
              <button type="button" onClick={() => { setShowReject(r => !r); setShowAccept(false); }}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                <X size={12} /> Reject
              </button>
            </>
          )}
          {order.status === 'preparing' && (
            <button type="button" onClick={() => void handleDispatch()} disabled={busy === 'dispatch'}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy === 'dispatch' ? <Spinner size="sm" /> : <Check size={12} />}
              Mark Ready
            </button>
          )}
          {order.status === 'ready' && (
            <button type="button" onClick={() => void handleDispatch()} disabled={busy === 'dispatch'}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
              {busy === 'dispatch' ? <Spinner size="sm" /> : <ShoppingBag size={12} />}
              Mark Dispatched
            </button>
          )}
          <button type="button" onClick={() => printOrder(order)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink">
            <Printer size={12} /> Print
          </button>
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Less' : 'Details'}
          </button>
        </div>

        {showReject && (
          <RejectForm
            onConfirm={r => void handleReject(r)}
            onCancel={() => setShowReject(false)}
            busy={busy === 'reject'}
          />
        )}

        {expanded && (
          <div className="space-y-4 border-t border-border pt-3">
            <PaymentBreakdown order={order} />
            <CustomerActions order={order} onCopied={() => onToast('info', 'Address copied')} />
            {order.deliveryPartnerName && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">Delivery partner</p>
                <p className="text-sm font-medium text-ink">{order.deliveryPartnerName}</p>
              </div>
            )}
            <OrderTimeline order={order} />
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink/30">ID: {order.platformOrderId}</span>
              <button type="button" onClick={() => { copyToClipboard(order.platformOrderId); onToast('info', 'Order ID copied'); }}
                className="text-ink/30 hover:text-ink/50"><Copy size={11} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Platform / status filter tabs ─────────────────────────────────────────────

type PlatformFilter = 'all' | AggregatorPlatform;
type StatusFilter   = 'all' | OnlineOrder['status'];

const PLATFORM_TABS: { key: PlatformFilter; label: string }[] = [
  { key: 'all',    label: 'All Platforms' },
  { key: 'swiggy', label: 'Swiggy' },
  { key: 'zomato', label: 'Zomato' },
];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'preparing', label: 'In Kitchen' },
  { key: 'ready',     label: 'Ready' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function FilterTabs<T extends string>({ tabs, active, onSelect }: {
  tabs: { key: T; label: string }[];
  active: T;
  onSelect: (k: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5">
      {tabs.map(t => (
        <button key={t.key} type="button" onClick={() => onSelect(t.key)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            active === t.key ? 'bg-brand text-white' : 'border border-border text-ink/60 hover:bg-mist hover:text-ink'
          }`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OnlineOrdersPage() {
  const [orders,      setOrders]      = useState<OnlineOrder[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [platFilter,  setPlatFilter]  = useState<PlatformFilter>('all');
  const [statFilter,  setStatFilter]  = useState<StatusFilter>('all');
  const { toasts, add: toast } = useToasts();
  const { socket } = useSocket();
  const shownRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOnlineOrders({ date: todayStr() });
      setOrders(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    const handler = (order: OnlineOrder) => {
      setOrders(prev => {
        if (prev.some(o => o._id === order._id)) return prev;
        return [order, ...prev];
      });
      if (!shownRef.current.has(order._id)) {
        shownRef.current.add(order._id);
        playNewOrderSound();
        toast('info', `New order from ${order.orderSource.toUpperCase()}: ${order.orderNumber}`);
      }
    };
    socket.on('new_delivery_order', handler);
    return () => { socket.off('new_delivery_order', handler); };
  }, [socket, toast]);

  function updateOrderStatus(id: string, status: OnlineOrder['status']) {
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
  }

  const visible = orders.filter(o => {
    if (platFilter !== 'all' && o.orderSource !== platFilter) return false;
    if (statFilter !== 'all' && o.status !== statFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Online Orders</h1>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-ink/60 hover:bg-mist hover:text-ink disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <StatsRow orders={orders} />

      <div className="space-y-2">
        <FilterTabs tabs={PLATFORM_TABS} active={platFilter} onSelect={setPlatFilter} />
        <FilterTabs tabs={STATUS_TABS}   active={statFilter} onSelect={setStatFilter} />
      </div>

      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <AlertCircle size={16} />{error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-canvas py-16 text-center">
          <ShoppingBag size={32} className="mb-3 text-ink/20" />
          <p className="font-semibold text-ink/50">No orders</p>
          <p className="mt-1 text-xs text-ink/35">
            {statFilter !== 'all' || platFilter !== 'all' ? 'Try adjusting your filters' : "Today's delivery orders will appear here"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(order => (
            <OrderCard
              key={order._id}
              order={order}
              onAccepted={id   => updateOrderStatus(id, 'preparing')}
              onRejected={id   => updateOrderStatus(id, 'cancelled')}
              onDispatched={id => updateOrderStatus(id, order.status === 'preparing' ? 'ready' : 'completed')}
              onToast={toast}
            />
          ))}
        </div>
      )}

      <ToastList toasts={toasts} />
    </div>
  );
}
