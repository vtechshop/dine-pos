import { useNavigate } from 'react-router-dom';
import { useLiveOrders } from '../../context/LiveOrdersContext';
import { useAuth } from '../../context/AuthContext';
import { OrderCard } from '../ui/OrderCard';
import { ShoppingCart } from 'lucide-react';

export function RightPanel() {
  const { orders } = useLiveOrders();
  const { role } = useAuth();
  const navigate = useNavigate();

  // Orders page (with the detail drawer) is admin-only; other staff work orders from Kitchen.
  const openOrder = (id: string, orderNumber: string) => {
    if (role === 'admin') {
      navigate(`/orders?order=${encodeURIComponent(id)}&q=${encodeURIComponent(orderNumber)}`);
    } else {
      navigate('/kitchen');
    }
  };

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-border bg-canvas">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <ShoppingCart size={15} className="text-ink/55" />
          <span className="text-sm font-semibold text-ink">Live Orders</span>
        </div>
        {orders.length > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
            {orders.length}
          </span>
        )}
      </div>

      {/* Order list — newest first */}
      <div className="flex-1 overflow-y-auto p-3">
        {orders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShoppingCart size={28} className="mb-2 text-ink/30" />
            <p className="text-sm text-ink/55">No orders yet</p>
            <p className="mt-1 text-xs text-ink/45">New orders appear here instantly</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map(order => (
              <button
                key={order.id}
                type="button"
                onClick={() => openOrder(order.id, order.orderNumber)}
                title={role === 'admin' ? 'Open order details' : 'Open kitchen'}
                className="block w-full rounded-xl text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <OrderCard order={order} />
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
