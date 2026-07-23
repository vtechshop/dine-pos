import { useState, useEffect } from 'react';
import { ShoppingBag } from 'lucide-react';

// ── Shared data contract ───────────────────────────────────────────────────────

export interface CustomerDisplayData {
  hotelName: string;
  sym: string;
  items: { name: string; qty: number; price: number; notes?: string }[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  updatedAt: string;
}

export const DISPLAY_KEY = 'pos_customer_display';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function readState(): CustomerDisplayData | null {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CustomerDisplayData;
  } catch { return null; }
}

// ── Welcome screen (empty cart) ───────────────────────────────────────────────

function WelcomeScreen({ hotelName }: { hotelName?: string }) {
  return (
    <div className="cd-welcome">
      <div className="cd-welcome-icon">
        <ShoppingBag size={56} />
      </div>
      {hotelName && <p className="cd-hotel">{hotelName}</p>}
      <h1 className="cd-welcome-title">Welcome!</h1>
      <p className="cd-welcome-sub">Your order will appear here</p>
    </div>
  );
}

// ── Order screen ──────────────────────────────────────────────────────────────

function OrderScreen({ data }: { data: CustomerDisplayData }) {
  const { sym, items, subtotal, taxTotal, grandTotal, hotelName } = data;
  return (
    <div className="cd-order">
      {hotelName && <p className="cd-hotel-small">{hotelName}</p>}

      <div className="cd-items">
        <div className="cd-items-header">
          <span>Item</span>
          <span>Qty</span>
          <span>Amount</span>
        </div>
        {items.map((item, i) => (
          <div key={i} className="cd-item-row">
            <div className="cd-item-name">
              <span>{item.name}</span>
              {item.notes && <span className="cd-item-note">{item.notes}</span>}
            </div>
            <span className="cd-item-qty">{item.qty}</span>
            <span className="cd-item-amt">{fmt(sym, item.price * item.qty)}</span>
          </div>
        ))}
      </div>

      <div className="cd-totals">
        <div className="cd-total-row">
          <span>Subtotal</span>
          <span>{fmt(sym, subtotal)}</span>
        </div>
        <div className="cd-total-row">
          <span>Tax</span>
          <span>{fmt(sym, taxTotal)}</span>
        </div>
        <div className="cd-total-row cd-total-grand">
          <span>Total</span>
          <span>{fmt(sym, grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CustomerDisplayPage() {
  const [data, setData] = useState<CustomerDisplayData | null>(() => readState());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === DISPLAY_KEY) {
        setData(readState());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const hasItems = data && data.items.length > 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="cd-root">
        {hasItems ? (
          <OrderScreen data={data} />
        ) : (
          <WelcomeScreen hotelName={data?.hotelName} />
        )}
      </div>
    </>
  );
}

// ── Styles (inlined — page renders outside Tailwind CSS scope) ────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f172a;
    --surface: #1e293b;
    --border: #334155;
    --muted: #64748b;
    --text: #f1f5f9;
    --text-sub: #94a3b8;
    --brand: #6366f1;
    --brand-light: #818cf8;
    --green: #34d399;
  }

  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; }

  .cd-root {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    padding: 2rem;
  }

  /* ── Welcome ── */
  .cd-welcome {
    text-align: center;
    max-width: 480px;
  }
  .cd-welcome-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 120px; height: 120px;
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--border);
    color: var(--brand-light);
    margin-bottom: 2rem;
  }
  .cd-hotel {
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--brand-light);
    margin-bottom: 0.75rem;
  }
  .cd-welcome-title {
    font-size: 3.5rem;
    font-weight: 800;
    color: var(--text);
    line-height: 1.1;
    margin-bottom: 0.75rem;
  }
  .cd-welcome-sub {
    font-size: 1.25rem;
    color: var(--text-sub);
  }

  /* ── Order ── */
  .cd-order {
    width: 100%;
    max-width: 680px;
  }
  .cd-hotel-small {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--brand-light);
    margin-bottom: 1.5rem;
  }
  .cd-items {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 1rem;
    overflow: hidden;
    margin-bottom: 1.5rem;
  }
  .cd-items-header {
    display: grid;
    grid-template-columns: 1fr 60px 100px;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .cd-item-row {
    display: grid;
    grid-template-columns: 1fr 60px 100px;
    gap: 1rem;
    align-items: center;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid var(--border);
    font-size: 1rem;
  }
  .cd-item-row:last-child { border-bottom: none; }
  .cd-item-name {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .cd-item-note {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .cd-item-qty {
    text-align: center;
    font-weight: 600;
    color: var(--text-sub);
  }
  .cd-item-amt {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cd-totals {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 1rem;
    overflow: hidden;
  }
  .cd-total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    font-size: 0.95rem;
    color: var(--text-sub);
    border-bottom: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }
  .cd-total-row:last-child { border-bottom: none; }
  .cd-total-grand {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--green);
    padding: 1.25rem;
  }
  .cd-total-grand span:first-child {
    color: var(--text);
  }
`;
