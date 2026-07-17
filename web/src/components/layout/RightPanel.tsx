import { useLiveOrders } from '../../context/LiveOrdersContext';
import { OrderCard } from '../ui/OrderCard';
import { ShoppingCart } from 'lucide-react';

export function RightPanel() {
  const { orders } = useLiveOrders();

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-[#1C0800]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2">
          <ShoppingCart size={15} className="text-white/40" />
          <span className="text-sm font-semibold text-white/80">Live Orders</span>
        </div>
        {orders.length > 0 && (
          <span className="rounded-full bg-[#E8380D] px-2 py-0.5 text-[10px] font-bold text-white">
            {orders.length}
          </span>
        )}
      </div>

      {/* Order list — newest first */}
      <div className="flex-1 overflow-y-auto p-3">
        {orders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShoppingCart size={28} className="mb-2 text-white/15" />
            <p className="text-sm text-white/30">No orders yet</p>
            <p className="mt-1 text-xs text-white/20">New orders appear here instantly</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map(order => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
