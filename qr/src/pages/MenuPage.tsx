import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@dinepos/shared/components';
import { useMenu } from '../context/MenuContext.tsx';
import { useCart } from '../context/CartContext.tsx';
import { useGuest } from '../context/GuestContext.tsx';
import { placeOrder } from '../api/orders.ts';
import { fetchSessionConfig } from '../api/session.ts';
import { CategoryTabs } from '../components/menu/CategoryTabs.tsx';
import { ProductGrid } from '../components/menu/ProductGrid.tsx';
import { CartBar } from '../components/cart/CartBar.tsx';
import { CartSheet } from '../components/cart/CartSheet.tsx';
import { GuestNamePrompt } from '../components/order/GuestNamePrompt.tsx';
import type { GuestInfo, QrOrder } from '../types/qr.ts';

interface MenuPageProps {
  hotelId:     string;
  tableNumber: string;
}

type ModalState = 'none' | 'cart' | 'guest-prompt' | 'placing';

export function MenuPage({ hotelId, tableNumber }: MenuPageProps) {
  const navigate = useNavigate();
  const { hotel, features, loading, error } = useMenu();
  const { items, clearCart } = useCart();
  const { guestToken, guestInfo, setGuestToken, setGuestInfo, addPlacedOrder } = useGuest();

  const [modal, setModal]       = useState<ModalState>('none');
  const [placeError, setPlaceError] = useState<string | null>(null);

  const tableSessions = features?.tableSessions ?? false;

  async function doPlaceOrder(info?: GuestInfo) {
    setModal('placing');
    setPlaceError(null);
    try {
      // For tableSessions flow, check if we need a guest prompt first
      let sessionToken = guestToken;
      if (tableSessions && !sessionToken) {
        const config = await fetchSessionConfig(hotelId, null);
        sessionToken = config.guestToken;
        if (sessionToken) setGuestToken(sessionToken);
      }

      const guestData = info ?? guestInfo;
      const result = await placeOrder({
        hotelId,
        tableNumber,
        items,
        guestToken:    sessionToken,
        name:          guestData?.name,
        phone:         guestData?.phone,
        tableSessions,
      });

      if (result.guestToken && !guestToken) {
        setGuestToken(result.guestToken);
      }

      const placedOrder: QrOrder = {
        _id:         result.order._id,
        orderNumber: result.order.orderNumber,
        status:      'pending',
        items:       [],
        grandTotal:  result.order.grandTotal,
        createdAt:   new Date().toISOString(),
      };
      addPlacedOrder(placedOrder);
      clearCart();
      navigate('/orders');
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : 'Failed to place order');
      setModal('cart');
    }
  }

  function handleCartConfirm() {
    // If tableSessions and no guestInfo, and name is required
    if (tableSessions && !guestInfo) {
      setModal('guest-prompt');
    } else {
      void doPlaceOrder();
    }
  }

  function handleGuestSubmit(info: GuestInfo) {
    setGuestInfo(info);
    void doPlaceOrder(info);
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
        <p className="text-[#1C0800] font-semibold mb-2">Menu unavailable</p>
        <p className="text-sm text-[#1C0800]/60">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF6EE] pb-28">
      <header className="bg-white border-b border-[#E8D5C0] px-4 py-3">
        <h1 className="font-bold text-[#1C0800]">{hotel?.name ?? 'Menu'}</h1>
        <p className="text-xs text-[#1C0800]/50">Table {tableNumber}</p>
      </header>

      <CategoryTabs />
      <ProductGrid />

      {placeError && (
        <div className="fixed top-4 inset-x-4 z-50 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl shadow">
          {placeError}
        </div>
      )}

      <CartBar onOpen={() => setModal('cart')} />

      {modal === 'cart' && (
        <CartSheet onClose={() => setModal('none')} onConfirm={handleCartConfirm} />
      )}
      {modal === 'guest-prompt' && (
        <GuestNamePrompt
          requiresPhone={features?.customerIdentification === 'name_mobile'}
          onSubmit={handleGuestSubmit}
        />
      )}
      {modal === 'placing' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-[#1C0800]">Placing order…</p>
          </div>
        </div>
      )}
    </div>
  );
}
