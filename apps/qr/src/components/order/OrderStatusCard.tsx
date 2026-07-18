import type { QrOrder } from '../../types/qr.ts';

const STATUS_LABELS: Record<QrOrder['status'], string> = {
  pending:   'Order received',
  preparing: 'Preparing',
  ready:     'Ready to serve',
  served:    'Served',
  paid:      'Paid',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<QrOrder['status'], string> = {
  pending:   'bg-yellow-100 text-yellow-800',
  preparing: 'bg-blue-100 text-blue-800',
  ready:     'bg-green-100 text-green-800',
  served:    'bg-[#E8380D]/10 text-[#E8380D]',
  paid:      'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};

interface OrderStatusCardProps {
  order:         QrOrder;
  currencySymbol: string;
}

export function OrderStatusCard({ order, currencySymbol }: OrderStatusCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E8D5C0] p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#1C0800]">#{order.orderNumber}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status]}`}>
          {STATUS_LABELS[order.status]}
        </span>
      </div>
      <div className="space-y-1">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-xs text-[#1C0800]/70">
            <span>{item.productName} × {item.quantity}</span>
            <span>{currencySymbol}{item.total.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 pt-2 border-t border-[#E8D5C0] text-sm font-semibold text-[#1C0800]">
        <span>Order total</span>
        <span>{currencySymbol}{order.grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
