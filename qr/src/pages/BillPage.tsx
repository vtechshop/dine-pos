import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@dinepos/shared/components';
import { useGuest } from '../context/GuestContext.tsx';
import { useMenu } from '../context/MenuContext.tsx';
import { fetchBill } from '../api/bill.ts';
import { BillView } from '../components/order/BillView.tsx';
import type { QrBill } from '../types/qr.ts';

const POLL_INTERVAL_MS = 20_000;

interface BillPageProps {
  hotelId: string;
}

export function BillPage({ hotelId }: BillPageProps) {
  const { guestToken } = useGuest();
  const { hotel } = useMenu();
  const symbol = hotel?.currencySymbol ?? '₹';

  const [bill, setBill]       = useState<QrBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const loadBill = useCallback(async () => {
    if (!guestToken) return;
    try {
      const data = await fetchBill(hotelId, guestToken);
      setBill(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bill');
    } finally {
      setLoading(false);
    }
  }, [hotelId, guestToken]);

  useEffect(() => {
    void loadBill();
    const timer = setInterval(() => void loadBill(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadBill]);

  if (!guestToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFF6EE] p-8 text-center">
        <p className="text-sm text-[#1C0800]/60">No active session found.</p>
        <Link to="/" className="mt-4 text-sm text-[#E8380D] font-medium">Back to menu</Link>
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
        <p className="text-[#1C0800] font-semibold mb-2">Couldn't load bill</p>
        <p className="text-sm text-[#1C0800]/60 mb-4">{error}</p>
        <button onClick={() => void loadBill()} className="text-sm text-[#E8380D] font-medium">
          Retry
        </button>
      </div>
    );
  }

  if (!bill) return null;

  return (
    <div className="min-h-screen bg-[#FFF6EE]">
      <header className="bg-white border-b border-[#E8D5C0] px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-[#1C0800]">Bill</h1>
        <Link to="/orders" className="text-xs text-[#E8380D] font-medium">← Back</Link>
      </header>

      <BillView bill={bill} currencySymbol={symbol} />

      {!bill.isBilled && (
        <div className="px-4 pb-6">
          <p className="text-xs text-center text-[#1C0800]/50">
            Please call a staff member or wait — your bill will be brought to you shortly.
          </p>
        </div>
      )}
    </div>
  );
}
