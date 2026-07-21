import { memo } from 'react';
import type { LiveOrder } from '../../types';

interface OrderCardProps {
  order: LiveOrder;
}

function timeLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export const OrderCard = memo(function OrderCard({ order }: OrderCardProps) {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors duration-300 ${
        order.isNew
          ? 'border-brand/20 bg-brand/[0.04]'
          : 'border-border bg-canvas'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {order.isNew && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand" />
          )}
          <span className="text-sm font-bold text-ink">#{order.orderNumber}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-border/40 px-1.5 py-0.5 text-[10px] font-semibold text-ink/60">
            {order.tableNumber}
          </span>
          <span className="text-[10px] text-ink/40 tabular-nums">{timeLabel(order.timestamp)}</span>
        </div>
      </div>

      <ul className="space-y-0.5">
        {order.items.slice(0, 4).map((item, i) => (
          <li key={i} className="flex items-center justify-between text-xs text-ink/60">
            <span className="truncate">{item.productName}</span>
            <span className="ml-2 shrink-0 font-semibold text-ink">×{item.quantity}</span>
          </li>
        ))}
        {order.items.length > 4 && (
          <li className="text-xs text-ink/40">+{order.items.length - 4} more items</li>
        )}
      </ul>

      {order.guestLabel && (
        <p className="mt-1.5 truncate text-[10px] text-ink/40">{order.guestLabel}</p>
      )}
    </div>
  );
});
