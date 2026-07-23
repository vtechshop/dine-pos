import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingBag, Clock, MapPin, Phone, User,
  ChevronDown, ChevronUp, Printer, Check, X,
  AlertCircle, RefreshCw, MessageCircle, Navigation,
  Copy, Timer, Bell, CheckCircle, Truck, Bike,
} from 'lucide-react';
import {
  fetchOnlineOrders,
  acceptDeliveryOrder,
  rejectDeliveryOrder,
  dispatchDeliveryOrder,
} from '../../api/aggregator';
import type { OnlineOrder } from '../../api/aggregator';
import { Spinner } from '../ui/Spinner';
import { useSocket } from '../../context/SocketContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function elapsedMins(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function fmtElapsed(iso: string) {
  const mins = elapsedMins(iso);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

// ── Sound (Web Audio API) ─────────────────────────────────────────────────────

function playNewOrderSound() {
  try {
    const ctx = new AudioContext();
    const beepAt = (startSec: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, startSec);
      gain.gain.linearRampToValueAtTime(0.4, startSec + 0.02);
      gain.gain.setValueAtTime(0.4, startSec + 0.12);
      gain.gain.linearRampToValueAtTime(0, startSec + 0.18);
      osc.start(startSec);
      osc.stop(startSec + 0.2);
    };
    beepAt(ctx.currentTime);
    beepAt(ctx.currentTime + 0.25);
    beepAt(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // AudioContext unavailable — skip silently
  }
}

function requestDesktopNotification(order: OnlineOrder) {
  if (!('Notification' in window)) return;
  const show = () => {
    try {
      new Notification(`New ${order.orderSource.toUpperCase()} Order`, {
        body: `${order.orderNumber} · ${order.customerName} · ${fmtINR(order.grandTotal)}`,
        tag: order._id,
        icon: '/favicon.ico',
      });
    } catch { /* silently ignore */ }
  };
  if (Notification.permission === 'granted') {
    show();
  } else if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then(p => { if (p === 'granted') show(); });
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast { id: number; type: 'success' | 'error' | 'info'; message: string }
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_tid;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 shadow-md text-xs font-medium ${
          t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {t.type === 'success' ? <Check size={12} /> : t.type === 'error' ? <AlertCircle size={12} /> : <Bell size={12} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Sub-tab types ─────────────────────────────────────────────────────────────

type SubTab = 'action' | 'kitchen' | 'ready' | 'delayed' | 'all';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'action',  label: 'Needs Action' },
  { key: 'kitchen', label: 'In Kitchen' },
  { key: 'ready',   label: 'Ready' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'all',     label: 'All' },
];

function filterByTab(orders: OnlineOrder[], tab: SubTab): OnlineOrder[] {
  switch (tab) {
    case 'action':  return orders.filter(o => o.status === 'pending');
    case 'kitchen': return orders.filter(o => o.status === 'preparing');
    case 'ready':   return orders.filter(o => o.status === 'ready');
    case 'delayed': return orders.filter(
      o => (o.status === 'pending' || o.status === 'preparing') && elapsedMins(o.createdAt) >= 20,
    );
    default: return orders;
  }
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

const DELAY_BORDER: Record<DelaySev, string> = {
  none:     'border-border',
  slow:     'border-amber-300 ring-1 ring-amber-100',
  late:     'border-red-300 ring-1 ring-red-100',
  critical: 'border-red-500 ring-2 ring-red-200',
};

function DelayBadge({ sev, createdAt }: { sev: DelaySev; createdAt: string }) {
  if (sev === 'none') return null;
  const mins = elapsedMins(createdAt);
  const cfg = sev === 'critical'
    ? { label: 'CRITICAL', cls: 'bg-red-600 text-white animate-pulse' }
    : sev === 'late'
    ? { label: 'LATE', cls: 'bg-red-100 border border-red-300 text-red-700' }
    : { label: 'SLOW', cls: 'bg-amber-50 border border-amber-200 text-amber-700' };
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${cfg.cls}`}>
      <Timer size={8} />
      {cfg.label} {mins}m
    </span>
  );
}

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: OnlineOrder['orderSource'] }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold text-white ${
      source === 'swiggy' ? 'bg-brand' : 'bg-red-600'
    }`}>
      {source === 'swiggy' ? <Bike size={8} /> : <Truck size={8} />}
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
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
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
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Prep time (min)</p>
      <div className="flex flex-wrap gap-1">
        {ETA_PRESETS.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
              value === m && isPreset
                ? 'bg-brand text-white'
                : 'border border-border text-ink/60 hover:border-brand hover:text-brand'
            }`}
          >
            {m}m
          </button>
        ))}
        <input
          type="number"
          min={5}
          max={120}
          value={!isPreset ? value : ''}
          placeholder="?"
          onChange={e => { const v = Number(e.target.value); if (v >= 5 && v <= 120) onChange(v); }}
          className={`w-11 rounded border px-1.5 py-0.5 text-[11px] text-center focus:outline-none ${
            !isPreset ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-mist text-ink/40'
          } focus:border-brand`}
          title="Custom minutes"
        />
      </div>
    </div>
  );
}

// ── Structured rejection form ─────────────────────────────────────────────────

const REJECT_PRESETS = [
  'Restaurant is busy',
  'Temporarily closed',
  'Item(s) unavailable',
  'Cannot deliver to address',
  'Order amount too low',
];

function RejectForm({
  onConfirm,
  onCancel,
  busy,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">Rejection reason</p>
      <div className="flex flex-wrap gap-1">
        {REJECT_PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setReason(p)}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
              reason === p
                ? 'border-red-400 bg-red-600 text-white'
                : 'border-red-200 bg-white text-red-700 hover:bg-red-100'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Or type a custom reason…"
        className="w-full rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-ink placeholder:text-ink/30 focus:border-red-400 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason.trim())}
          className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Spinner size="sm" /> : <X size={10} />}
          Reject Order
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2.5 py-1 text-[11px] font-semibold text-ink/60 hover:bg-mist"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Payment breakdown ─────────────────────────────────────────────────────────

function PaymentBreakdown({ order }: { order: OnlineOrder }) {
  const tax        = order.taxTotal        ?? 0;
  const discount   = order.discountAmount  ?? 0;
  const commission = order.platformCommission ?? 0;
  const netSettle  = order.grandTotal - commission;
  const subtotal   = order.subtotal ?? (order.grandTotal - tax + discount - order.deliveryFee);

  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Payment</p>
      <div className="rounded-lg border border-border bg-mist/40 p-2 space-y-0.5">
        {subtotal > 0 && (
          <div className="flex justify-between text-[11px] text-ink/60">
            <span>Subtotal</span><span>{fmtINR(subtotal)}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between text-[11px] text-ink/60">
            <span>Tax</span><span>{fmtINR(tax)}</span>
          </div>
        )}
        {order.deliveryFee > 0 && (
          <div className="flex justify-between text-[11px] text-ink/60">
            <span>Delivery fee</span><span>{fmtINR(order.deliveryFee)}</span>
          </div>
        )}
        {discount > 0 && (
          <div className="flex justify-between text-[11px] text-emerald-700">
            <span>Discount</span><span>-{fmtINR(discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs font-bold text-ink border-t border-border pt-0.5 mt-1">
          <span>Grand Total</span><span>{fmtINR(order.grandTotal)}</span>
        </div>
        {commission > 0 && (
          <>
            <div className="flex justify-between text-[11px] text-red-600">
              <span>{order.orderSource === 'swiggy' ? 'Swiggy' : 'Zomato'} commission</span>
              <span>-{fmtINR(commission)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-bold text-emerald-700 border-t border-border pt-0.5 mt-1">
              <span>Net to restaurant</span><span>{fmtINR(netSettle)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Order timeline ────────────────────────────────────────────────────────────

interface TimelineEvent { label: string; time: string | null; done: boolean }

function buildTimeline(order: OnlineOrder): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { label: 'Order placed', time: order.createdAt, done: true },
  ];
  if (order.status === 'cancelled') {
    events.push({ label: 'Accepted', time: null, done: false });
    events.push({ label: `Rejected${order.rejectionReason ? `: ${order.rejectionReason}` : ''}`, time: order.rejectedAt, done: !!order.rejectedAt });
    return events;
  }
  const accepted = !!order.acceptedAt;
  events.push({ label: accepted ? 'Accepted by cashier' : 'Awaiting acceptance', time: order.acceptedAt, done: accepted });
  const inKitchen = ['preparing', 'ready', 'served', 'completed'].includes(order.status);
  events.push({ label: 'Sent to kitchen', time: accepted ? order.acceptedAt : null, done: accepted && inKitchen });
  const isReady = ['ready', 'served', 'completed'].includes(order.status);
  events.push({ label: 'Ready for pickup', time: null, done: isReady });
  const done = order.status === 'served' || order.status === 'completed';
  events.push({ label: 'Order dispatched', time: null, done });
  return events;
}

function OrderTimeline({ order }: { order: OnlineOrder }) {
  const events = buildTimeline(order);
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Timeline</p>
      <div className="space-y-1.5 pl-4 relative">
        {events.map((ev, i) => (
          <div key={i} className="relative flex items-start gap-2">
            <span className={`absolute -left-3.5 mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 ${
              ev.done ? 'border-brand bg-brand' : 'border-border bg-canvas'
            }`}>
              {ev.done && <Check size={6} className="text-white" />}
            </span>
            <div>
              <p className={`text-[11px] font-medium ${ev.done ? 'text-ink' : 'text-ink/30'}`}>{ev.label}</p>
              {ev.time && <p className="text-[10px] text-ink/40">{fmtTime(ev.time)}</p>}
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
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const waUrl = phone
    ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, your ${order.orderSource} order #${order.orderNumber} is confirmed!`)}`
    : null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Customer</p>
      <div className="flex flex-wrap gap-1">
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-ink/60 hover:bg-mist hover:text-ink">
            <Phone size={9} /> Call
          </a>
        )}
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 rounded border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50">
            <MessageCircle size={9} /> WhatsApp
          </a>
        )}
        {address && (
          <button type="button" onClick={() => { copyToClipboard(address); onCopied(); }}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-ink/60 hover:bg-mist hover:text-ink">
            <Copy size={9} /> Copy Address
          </button>
        )}
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 rounded border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50">
            <Navigation size={9} /> Maps
          </a>
        )}
      </div>
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
  win.document.close();
  win.focus();
  win.print();
}

// ── New Order Alert Banner ────────────────────────────────────────────────────

interface AlertProps {
  order: OnlineOrder;
  onDismiss: () => void;
  onAccepted: (id: string) => void;
  onRejected: (id: string) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}

function NewOrderAlert({ order, onDismiss, onAccepted, onRejected, onToast }: AlertProps) {
  const [countdown, setCountdown] = useState(15);
  const [busy,      setBusy]      = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    if (countdown <= 0) { onDismiss(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onDismiss]);

  async function handleQuickAccept() {
    setBusy('accept');
    try {
      await acceptDeliveryOrder(order._id, 20);
      onAccepted(order._id);
      onToast('success', `Accepted: ${order.orderNumber}`);
      onDismiss();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to accept');
    } finally { setBusy(null); }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    try {
      await rejectDeliveryOrder(order._id, reason);
      onRejected(order._id);
      onToast('success', `Rejected: ${order.orderNumber}`);
      onDismiss();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(null); setShowReject(false); }
  }

  return (
    <div className="mx-3 mt-2 rounded-xl border-2 border-brand bg-brand/5 p-3 shadow-md">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Bell size={11} className="text-brand animate-bounce shrink-0" />
          <span className="text-xs font-bold text-brand">New Order!</span>
          <PlatformBadge source={order.orderSource} />
          <span className="font-mono text-xs font-bold text-ink">{order.orderNumber}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold text-ink/40">{countdown}s</span>
          <button type="button" onClick={onDismiss} className="rounded p-0.5 text-ink/40 hover:bg-mist hover:text-ink">
            <X size={11} />
          </button>
        </div>
      </div>
      <p className="mb-2 text-[11px] text-ink/70">
        {order.customerName} &bull; {fmtINR(order.grandTotal)} &bull; {order.items.length} item{order.items.length !== 1 ? 's' : ''}
      </p>
      {!showReject ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => void handleQuickAccept()} disabled={busy === 'accept'}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy === 'accept' ? <Spinner size="sm" /> : <CheckCircle size={10} />}
            Accept (20m)
          </button>
          <button type="button" onClick={() => setShowReject(true)}
            className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100">
            <X size={10} />
            Reject
          </button>
          <button type="button" onClick={() => printOrder(order)}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-ink/50 hover:bg-mist">
            <Printer size={10} />
            Print
          </button>
        </div>
      ) : (
        <RejectForm
          onConfirm={r => void handleReject(r)}
          onCancel={() => setShowReject(false)}
          busy={busy === 'reject'}
        />
      )}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ orders }: { orders: OnlineOrder[] }) {
  const pending = orders.filter(o => o.status === 'pending').length;
  const kitchen = orders.filter(o => o.status === 'preparing').length;
  const ready   = orders.filter(o => o.status === 'ready').length;
  const revenue = orders
    .filter(o => !['cancelled'].includes(o.status))
    .reduce((s, o) => s + o.grandTotal, 0);

  const chips = [
    { label: 'Pending', value: String(pending), cls: pending > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-canvas border-border text-ink/40' },
    { label: 'Kitchen', value: String(kitchen), cls: kitchen > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-canvas border-border text-ink/40' },
    { label: 'Ready',   value: String(ready),   cls: ready   > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-canvas border-border text-ink/40' },
    { label: 'Revenue', value: fmtINR(revenue), cls: 'bg-canvas border-border text-ink/60' },
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 shrink-0">
      {chips.map(c => (
        <div key={c.label} className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 ${c.cls}`}>
          <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">{c.label}</span>
          <span className="text-xs font-bold">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onStatusChange,
  onToast,
}: {
  order: OnlineOrder;
  onStatusChange: (id: string, status: OnlineOrder['status']) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}) {
  const [expanded,   setExpanded]   = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [prepMin,    setPrepMin]    = useState(20);
  const [busy,       setBusy]       = useState<string | null>(null);

  const sev     = delaySeverity(order);
  const preview = order.items.slice(0, 2);
  const extra   = order.items.length - 2;

  async function handleAccept() {
    setBusy('accept');
    try {
      await acceptDeliveryOrder(order._id, prepMin);
      onStatusChange(order._id, 'preparing');
      onToast('success', `Accepted: ${order.orderNumber} (${prepMin}m ETA)`);
      setShowAccept(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to accept');
    } finally { setBusy(null); }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    try {
      await rejectDeliveryOrder(order._id, reason);
      onStatusChange(order._id, 'cancelled');
      onToast('success', `Rejected: ${order.orderNumber}`);
      setShowReject(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(null); }
  }

  async function handleDispatch() {
    setBusy('dispatch');
    try {
      await dispatchDeliveryOrder(order._id);
      onStatusChange(order._id, order.status === 'preparing' ? 'ready' : 'completed');
      onToast('success', `Updated: ${order.orderNumber}`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update');
    } finally { setBusy(null); }
  }

  return (
    <div className={`rounded-xl border bg-canvas shadow-sm transition ${DELAY_BORDER[sev]}`}>
      {/* Header */}
      <div className="flex items-start gap-2.5 p-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <PlatformBadge source={order.orderSource} />
            <span className="font-mono text-xs font-bold text-ink">{order.orderNumber}</span>
            <StatusBadge status={order.status} />
            <DelayBadge sev={sev} createdAt={order.createdAt} />
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <User size={9} className="shrink-0 text-ink/40" />
            <span className="font-medium text-ink truncate">{order.customerName}</span>
            {order.customerPhone && (
              <>
                <span className="text-ink/30">&bull;</span>
                <a href={`tel:${order.customerPhone}`} className="text-brand text-[10px] hover:underline shrink-0">
                  <Phone size={9} className="inline mr-0.5" />{order.customerPhone}
                </a>
              </>
            )}
          </div>
          {order.deliveryAddress && (
            <div className="flex items-start gap-1 text-[10px] text-ink/50">
              <MapPin size={9} className="mt-0.5 shrink-0" />
              <span className="truncate">{order.deliveryAddress}</span>
            </div>
          )}
          <div className="text-[10px] text-ink/50">
            {preview.map((item, i) => (
              <span key={i}>{i > 0 && ', '}{item.productName} ×{item.quantity}</span>
            ))}
            {extra > 0 && <span className="text-ink/35"> +{extra} more</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-ink">{fmtINR(order.grandTotal)}</p>
          <p className="text-[10px] text-ink/40">{fmtElapsed(order.createdAt)}</p>
          {order.estimatedPickupTime && (
            <p className="text-[10px] text-blue-600">
              <Clock size={8} className="inline mr-0.5" />
              ETA {fmtTime(order.estimatedPickupTime)}
            </p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-3 py-2">
        <button type="button" onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-0.5 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink">
          {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          {expanded ? 'Less' : 'Detail'}
        </button>
        <button type="button" onClick={() => printOrder(order)}
          className="flex items-center gap-0.5 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink">
          <Printer size={9} /> Print
        </button>

        {order.status === 'pending' && (
          <>
            <button type="button"
              onClick={() => { setShowAccept(a => !a); setShowReject(false); }}
              className={`flex items-center gap-0.5 rounded px-2 py-1 text-[10px] font-bold transition ${
                showAccept ? 'bg-emerald-100 border border-emerald-300 text-emerald-800' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}>
              <Check size={9} /> Accept
            </button>
            <button type="button"
              onClick={() => { setShowReject(r => !r); setShowAccept(false); }}
              className={`flex items-center gap-0.5 rounded px-2 py-1 text-[10px] font-bold transition ${
                showReject ? 'bg-red-100 border border-red-300 text-red-800' : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              }`}>
              <X size={9} /> Reject
            </button>
          </>
        )}
        {order.status === 'preparing' && (
          <button type="button" onClick={() => void handleDispatch()} disabled={busy === 'dispatch'}
            className="flex items-center gap-0.5 rounded bg-blue-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy === 'dispatch' ? <Spinner size="sm" /> : <Check size={9} />}
            Mark Ready
          </button>
        )}
        {order.status === 'ready' && (
          <button type="button" onClick={() => void handleDispatch()} disabled={busy === 'dispatch'}
            className="flex items-center gap-0.5 rounded bg-purple-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-purple-700 disabled:opacity-50">
            {busy === 'dispatch' ? <Spinner size="sm" /> : <ShoppingBag size={9} />}
            Dispatch
          </button>
        )}
      </div>

      {/* Accept with ETA picker */}
      {showAccept && (
        <div className="border-t border-border/60 bg-emerald-50/40 px-3 pb-3 pt-2 space-y-2">
          <EtaPicker value={prepMin} onChange={setPrepMin} />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void handleAccept()} disabled={busy === 'accept'}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy === 'accept' ? <Spinner size="sm" /> : <CheckCircle size={10} />}
              Confirm ({prepMin}m)
            </button>
            <button type="button" onClick={() => setShowAccept(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-ink/60 hover:bg-mist">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reject form */}
      {showReject && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <RejectForm
            onConfirm={r => void handleReject(r)}
            onCancel={() => setShowReject(false)}
            busy={busy === 'reject'}
          />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2 space-y-3">
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Items</p>
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-ink/80">{item.productName} <span className="text-ink/40">×{item.quantity}</span></span>
                <span className="font-medium text-ink">{fmtINR(item.total)}</span>
              </div>
            ))}
          </div>

          <PaymentBreakdown order={order} />

          <CustomerActions order={order} onCopied={() => onToast('info', 'Address copied')} />

          {order.deliveryPartnerName && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Delivery partner</p>
              <p className="text-xs font-medium text-ink">{order.deliveryPartnerName}</p>
            </div>
          )}

          <OrderTimeline order={order} />

          {order.notes && (
            <p className="text-[11px] italic text-ink/50">Note: {order.notes}</p>
          )}

          <div className="flex items-center gap-1.5">
            <p className="font-mono text-[10px] text-ink/25">ID: {order.platformOrderId}</p>
            <button type="button"
              onClick={() => { copyToClipboard(order.platformOrderId); onToast('info', 'Order ID copied'); }}
              className="text-ink/25 hover:text-ink/50">
              <Copy size={9} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: SubTab }) {
  const msgs: Record<SubTab, string> = {
    action:  'No orders awaiting acceptance',
    kitchen: 'No orders in kitchen right now',
    ready:   'No orders ready for pickup',
    delayed: 'All orders on time',
    all:     "Today's delivery orders will appear here",
  };
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <ShoppingBag size={28} className="mb-2 text-ink/20" />
      <p className="text-xs font-semibold text-ink/40">{msgs[tab]}</p>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function OnlineOrdersPanel() {
  const [orders,  setOrders]  = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [subTab,  setSubTab]  = useState<SubTab>('action');
  const [alert,   setAlert]   = useState<OnlineOrder | null>(null);
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
        setAlert(order);
        playNewOrderSound();
        requestDesktopNotification(order);
      }
    };
    socket.on('new_delivery_order', handler);
    return () => { socket.off('new_delivery_order', handler); };
  }, [socket]);

  function updateOrder(id: string, status: OnlineOrder['status']) {
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
  }

  const visible = filterByTab(orders, subTab);

  function tabCount(tab: SubTab): number {
    if (tab === 'all') return 0;
    return filterByTab(orders, tab).length;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Stats */}
      <StatsBar orders={orders} />

      {/* Sub-tabs */}
      <div className="shrink-0 border-b border-border">
        <div className="flex gap-0.5 overflow-x-auto px-1 pb-1 pt-1">
          {SUB_TABS.map(t => {
            const count  = tabCount(t.key);
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={`relative shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  active ? 'bg-brand text-white' : 'text-ink/60 hover:bg-mist hover:text-ink'
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                    active ? 'bg-white text-brand' : 'bg-amber-400 text-white'
                  }`}>
                    {count}
                  </span>
                )}
                {t.key === 'delayed' && count > 0 && !active && (
                  <AlertCircle size={10} className="text-red-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between border-b border-border px-3 py-1.5">
        <p className="text-[10px] text-ink/40">
          {visible.length} order{visible.length !== 1 ? 's' : ''}
        </p>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink disabled:opacity-50">
          <RefreshCw size={9} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* New order alert */}
      {alert && (
        <NewOrderAlert
          order={alert}
          onDismiss={() => setAlert(null)}
          onAccepted={id => { updateOrder(id, 'preparing'); setAlert(null); }}
          onRejected={id => { updateOrder(id, 'cancelled'); setAlert(null); }}
          onToast={toast}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertCircle size={12} />
            {error}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState tab={subTab} />
        ) : (
          <div className="space-y-2">
            {visible.map(order => (
              <OrderCard
                key={order._id}
                order={order}
                onStatusChange={updateOrder}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>

      <ToastList toasts={toasts} />
    </div>
  );
}
