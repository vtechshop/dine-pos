import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@dinepos/shared/components';
import { useGuest } from '../context/GuestContext.tsx';
import { useMenu } from '../context/MenuContext.tsx';
import { fetchBill } from '../api/bill.ts';
import { useOrderSocket } from '../hooks/useOrderSocket.ts';
import { OrderStatusCard } from '../components/order/OrderStatusCard.tsx';
import type { QrBill } from '../types/qr.ts';

const POLL_INTERVAL_MS = 15_000;

interface OrderStatusPageProps {
  hotelId:     string;
  tableNumber: string;
}

export function OrderStatusPage({ hotelId, tableNumber }: OrderStatusPageProps) {
  const { guestToken } = useGuest();
  const { hotel, features } = useMenu();
  const symbol = hotel?.currencySymbol ?? '₹';
  const tableSessions = features?.tableSessions ?? false;

  const [bill, setBill]       = useState<QrBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const loadBill = useCallback(async () => {
    if (!guestToken || !tableSessions) return;
    try {
      const data = await fetchBill(hotelId, guestToken);
      setBill(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [hotelId, guestToken, tableSessions]);

  // Initial load + polling
  useEffect(() => {
    void loadBill();
    const timer = setInterval(() => void loadBill(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadBill]);

  // Socket for optional server-push refresh
  useOrderSocket({
    hotelId,
    tableNumber,
    enabled: tableSessions && !!guestToken,
    onUpdate: () => void loadBill(),
  });

  if (!tableSessions) {
    return (
      <div className="min-h-screen bg-[#FFF6EE] flex flex-col items-center justify-center p-8 text-center">
        <p className="text-[#1C0800] font-semibold mb-2">Order placed!</p>
        <p className="text-sm text-[#1C0800]/60 mb-6">
          Your order has been sent to the kitchen. A staff member will serve you shortly.
        </p>
        <Link to="/" className="text-sm text-[#E8380D] font-medium">← Back to menu</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FFF6EE]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFF6EE] p-8 text-center">
        <p className="text-[#1C0800] font-semibold mb-2">Couldn't load orders</p>
        <p className="text-sm text-[#1C0800]/60 mb-4">{error}</p>
        <button
          onClick={() => void loadBill()}
          className="text-sm text-[#E8380D] font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  const activeOrders = bill?.orders.filter((o) => o.status !== 'cancelled') ?? [];

  return (
    <div className="min-h-screen bg-[#FFF6EE] pb-6">
      <header className="bg-white border-b border-[#E8D5C0] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-[#1C0800]">Your orders</h1>
          <p className="text-xs text-[#1C0800]/50">Table {tableNumber}</p>
        </div>
        <Link to="/" className="text-xs text-[#E8380D] font-medium">Add more</Link>
      </header>

      <div className="p-4">
        {activeOrders.length === 0 ? (
          <p className="text-center text-sm text-[#1C0800]/50 py-12">No active orders</p>
        ) : (
          activeOrders.map((order) => (
            <OrderStatusCard key={order._id} order={order} currencySymbol={symbol} />
          ))
        )}
      </div>

      {bill && !bill.isBilled && activeOrders.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-[#FFF6EE] border-t border-[#E8D5C0]">
          <Link
            to="/bill"
            className="block w-full py-3 text-center bg-[#1C0800] text-white rounded-xl font-semibold"
          >
            Request bill — {symbol}{bill.grandTotal.toFixed(2)}
          </Link>
        </div>
      )}
    </div>
  );
}
