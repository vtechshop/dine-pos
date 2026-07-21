import { Phone, ShoppingBag, Calendar } from 'lucide-react';
import type { OrderCustomer } from '../../api/orders';

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

function formatPhone(phone: string): string {
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return phone;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatCurrency(amount: number, sym: string): string {
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

interface Props {
  customer: OrderCustomer;
  currencySymbol: string;
}

export function OrderOnlyCustomerPanel({ customer, currencySymbol }: Props) {
  const avgBill = customer.totalOrders > 0
    ? customer.totalSpent / customer.totalOrders
    : 0;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border bg-canvas px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink/[0.08] text-sm font-bold text-ink/40">
            {initials(customer.customerName || 'Guest')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">
                {customer.customerName || 'Guest'}
              </h2>
              <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/40">
                Order history only
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink/60">
              <Phone size={11} className="shrink-0 text-ink/30" />
              {formatPhone(customer.phone)}
            </div>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-mist">
        {[
          { label: 'Orders',    value: customer.totalOrders.toString() },
          { label: 'Lifetime',  value: formatCurrency(customer.totalSpent, currencySymbol) },
          { label: 'Avg Bill',  value: formatCurrency(avgBill, currencySymbol) },
          { label: 'Last Order', value: formatDate(customer.lastOrderDate) },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* Order history summary */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingBag size={13} className="text-ink/30" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            Order Activity
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-ink/60">
            <Calendar size={11} className="shrink-0 text-ink/25" />
            <span>First order: <span className="font-medium text-ink">{formatDate(customer.firstOrderDate)}</span></span>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink/60">
            <Calendar size={11} className="shrink-0 text-ink/25" />
            <span>Last order: <span className="font-medium text-ink">{formatDate(customer.lastOrderDate)}</span></span>
          </div>
        </div>
      </div>

      {/* Not enrolled notice */}
      <div className="mx-6 rounded-lg border border-border bg-mist px-4 py-3">
        <p className="text-xs font-medium text-ink/60">Not enrolled in loyalty program</p>
        <p className="mt-0.5 text-[10px] text-ink/35">
          This customer has placed orders but has no loyalty profile. Enroll them via the loyalty settings to start tracking points.
        </p>
      </div>
    </div>
  );
}
