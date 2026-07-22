import { useState } from 'react';
import { Clock, Trash2, Play, Search, ShoppingBag, UtensilsCrossed, Truck } from 'lucide-react';
import { useCashier, type HeldBill } from '../../context/CashierContext';
import { useSettings } from '../../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const TYPE_ICON: Record<HeldBill['orderType'], React.ReactNode> = {
  'dine-in':  <UtensilsCrossed size={13} />,
  'takeaway': <ShoppingBag size={13} />,
  'delivery': <Truck size={13} />,
};

const TYPE_LABEL: Record<HeldBill['orderType'], string> = {
  'dine-in':  'Dine In',
  'takeaway': 'Takeaway',
  'delivery': 'Delivery',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function HoldBillPanel({ onResume }: { onResume?: () => void }) {
  const { heldBills, resumeBill, deleteHeldBill, setActiveTab, addToCart, clearCart } = useCashier();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = query.trim()
    ? heldBills.filter(b =>
        b.label.toLowerCase().includes(query.toLowerCase()) ||
        (b.customerName ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (b.tableNumber ?? '').includes(query),
      )
    : heldBills;

  function handleResume(id: string) {
    const bill = resumeBill(id);
    if (!bill) return;
    clearCart();
    for (const item of bill.items) addToCart(item);
    setActiveTab('new-order');
    onResume?.();
  }

  function handleDelete(id: string) {
    deleteHeldBill(id);
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Hold / Park Bills</h2>
        {heldBills.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {heldBills.length} held
          </span>
        )}
      </div>

      {/* Search */}
      {heldBills.length > 3 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search held bills…"
            className="w-full rounded-lg border border-border bg-canvas py-2 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
        </div>
      )}

      {/* Empty state */}
      {heldBills.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <Clock size={24} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm font-medium text-ink/40">No held bills</p>
          <p className="mt-0.5 text-xs text-ink/30">Bills you park will appear here</p>
        </div>
      )}

      {/* Bill list */}
      <div className="space-y-2.5">
        {filtered.map(bill => (
          <div
            key={bill.id}
            className="rounded-xl border border-border bg-canvas p-4"
          >
            <div className="flex items-start justify-between gap-2">
              {/* Left: info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-ink/40">{TYPE_ICON[bill.orderType]}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">
                    {TYPE_LABEL[bill.orderType]}
                  </span>
                  {bill.tableNumber && (
                    <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] font-medium text-ink/60">
                      T{bill.tableNumber}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold text-ink truncate">{bill.label}</p>
                {bill.customerName && (
                  <p className="text-xs text-ink/50 truncate">{bill.customerName}</p>
                )}
                {bill.customerPhone && (
                  <p className="text-xs text-ink/45">{bill.customerPhone}</p>
                )}

                {/* Items preview */}
                <div className="mt-2 space-y-0.5">
                  {bill.items.slice(0, 3).map(item => (
                    <p key={item.id} className="text-xs text-ink/55">
                      {item.productName} × {item.quantity}
                    </p>
                  ))}
                  {bill.items.length > 3 && (
                    <p className="text-xs text-ink/40">+{bill.items.length - 3} more items</p>
                  )}
                </div>
              </div>

              {/* Right: amount + actions */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <p className="text-sm font-bold text-ink">{fmtINR(sym, bill.grandTotal)}</p>
                <p className="text-[10px] text-ink/40">{fmtAge(bill.heldAt)}</p>
                <div className="flex gap-1.5">
                  {confirmDelete === bill.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg border border-border px-2 py-1 text-xs text-ink/60 hover:bg-mist"
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(bill.id)}
                        className="rounded-lg bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(bill.id)}
                        title="Delete held bill"
                        className="rounded-lg border border-border p-1.5 text-ink/40 hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResume(bill.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
                      >
                        <Play size={11} />
                        Resume
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Hold meta */}
            <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-2.5">
              <span className="text-[10px] text-ink/40">Held by {bill.cashierName}</span>
              <span className="text-[10px] text-ink/30">·</span>
              <span className="text-[10px] text-ink/40">
                {new Date(bill.heldAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && heldBills.length > 0 && (
        <p className="text-center text-sm text-ink/40">No bills match "{query}"</p>
      )}
    </div>
  );
}
