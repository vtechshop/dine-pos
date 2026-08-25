import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicFetch } from '../api/client.ts';
import { loadRazorpayScript } from '../utils/razorpay.ts';
import { Bell, Search, Leaf, X } from 'lucide-react';
import { Spinner } from '@dinepos/shared/components';
import { useMenu } from '../context/MenuContext.tsx';
import { useCart } from '../context/CartContext.tsx';
import { useGuest } from '../context/GuestContext.tsx';
import { placeOrder } from '../api/orders.ts';
import { fetchSessionConfig } from '../api/session.ts';
import { callWaiter } from '../api/waiter.ts';
import { CategoryTabs } from '../components/menu/CategoryTabs.tsx';
import { ProductGrid } from '../components/menu/ProductGrid.tsx';
import { CartBar } from '../components/cart/CartBar.tsx';
import { CartSheet } from '../components/cart/CartSheet.tsx';
import { GuestNamePrompt } from '../components/order/GuestNamePrompt.tsx';
import { BottomNav } from '../components/layout/BottomNav.tsx';
import type { GuestInfo, QrOrder } from '../types/qr.ts';

interface MenuPageProps {
  hotelId:     string;
  tableNumber: string;
}

type ModalState = 'none' | 'cart' | 'guest-prompt' | 'placing' | 'waiter';

interface PendingPaymentData {
  orderId:               string;
  orderNumber:           string;
  keyId:                 string;
  razorpayOrderId:       string;
  internalTransactionId: string;
  amountPaise:           number;
  customerName?:         string;
  customerPhone?:        string;
}

const WAITER_PRESETS = [
  '[Waiter Request] Need assistance please',
  '[Waiter Request] Need water please',
  '[Waiter Request] Need extra napkins / cutlery',
  '[Waiter Request] Ready to order more',
  '[Waiter Request] Ready to pay',
];

export function MenuPage({ hotelId, tableNumber }: MenuPageProps) {
  const navigate = useNavigate();
  const { hotel, features, loading, error } = useMenu();
  const { items, clearCart } = useCart();
  const { guestToken, guestInfo, setGuestToken, setGuestInfo, addPlacedOrder } = useGuest();

  const [modal, setModal]               = useState<ModalState>('none');
  const [placeError, setPlaceError]     = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [vegOnly, setVegOnly]           = useState(false);
  const [waiterSent, setWaiterSent]     = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPaymentData | null>(null);

  const tableSessions = features?.tableSessions ?? false;
  const businessType  = hotel?.businessType ?? 'both';
  const showVegToggle = businessType === 'both';

  async function doPlaceOrder(info?: GuestInfo) {
    setModal('placing');
    setPlaceError(null);

    try {
      const guestData = info ?? guestInfo;
      let pay: PendingPaymentData;

      if (pendingPayment) {
        // Retry after cancel — reuse the existing payment_pending order
        pay = pendingPayment;
      } else {
        // First attempt — create order
        let sessionToken = guestToken;
        if (tableSessions && !sessionToken) {
          const cfg = await fetchSessionConfig(hotelId, null);
          sessionToken = cfg.guestToken;
          if (sessionToken) setGuestToken(sessionToken);
        }

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

        if (!tableSessions) {
          // Legacy non-tableSessions path: no Razorpay gate
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
          return;
        }

        // Get Razorpay checkout params from backend
        const rpOrder = await publicFetch<{
          keyId:                 string;
          razorpayOrderId:       string;
          internalTransactionId: string;
          amount:                number;
        }>('/public/payments/razorpay-order', {
          method: 'POST',
          body: JSON.stringify({
            hotelId,
            orderId:      result.order._id,
            amount:       result.order.grandTotal,
            customerName: guestData?.name,
          }),
        });

        pay = {
          orderId:               result.order._id,
          orderNumber:           result.order.orderNumber,
          keyId:                 rpOrder.keyId,
          razorpayOrderId:       rpOrder.razorpayOrderId,
          internalTransactionId: rpOrder.internalTransactionId,
          amountPaise:           rpOrder.amount,
          customerName:          guestData?.name,
          customerPhone:         guestData?.phone,
        };
        setPendingPayment(pay);
      }

      // Open Razorpay Checkout (native full-screen modal)
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error('Razorpay could not load. Check your internet connection.');

      setModal('none'); // close our modal — Razorpay opens its own overlay

      const rzpResponse = await new Promise<{
        razorpay_payment_id: string;
        razorpay_order_id:   string;
        razorpay_signature:  string;
      }>((resolve, reject) => {
        let done = false;
        const rzp = new window.Razorpay({
          key:         pay.keyId,
          amount:      pay.amountPaise,
          currency:    'INR',
          name:        hotel?.name ?? 'DinePOS',
          description: `Order #${pay.orderNumber}`,
          order_id:    pay.razorpayOrderId,
          prefill: {
            name:    pay.customerName,
            contact: pay.customerPhone,
          },
          theme: { color: '#F97316' },
          handler: (response) => {
            done = true;
            resolve(response);
          },
          modal: {
            ondismiss: () => {
              if (!done) reject(new Error('Payment cancelled. Tap "Pay Now" to try again.'));
            },
          },
        });
        rzp.open();
      });

      // Server-side verification — releases the order to the kitchen
      setModal('placing');
      await publicFetch('/public/payments/qr-verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_payment_id:   rzpResponse.razorpay_payment_id,
          razorpay_order_id:     rzpResponse.razorpay_order_id,
          razorpay_signature:    rzpResponse.razorpay_signature,
          internalTransactionId: pay.internalTransactionId,
          orderId:               pay.orderId,
          hotelId,
        }),
      });

      setPendingPayment(null);
      const placedOrder: QrOrder = {
        _id:         pay.orderId,
        orderNumber: pay.orderNumber,
        status:      'pending',
        items:       [],
        grandTotal:  pay.amountPaise / 100,
        createdAt:   new Date().toISOString(),
      };
      addPlacedOrder(placedOrder);
      clearCart();
      navigate('/orders');
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setModal('cart');
    }
  }

  function handleCartConfirm() {
    if (pendingPayment) {
      // Retry after cancel — skip order creation and guest prompt
      void doPlaceOrder();
      return;
    }
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

  async function handleWaiterPreset(msg: string) {
    setModal('none');
    try {
      await callWaiter(hotelId, tableNumber, msg);
    } catch {
      // Fire-and-forget; a failed call still shows the toast to avoid confusing the guest
    }
    setWaiterSent(true);
    setTimeout(() => setWaiterSent(false), 3000);
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
    <div className="min-h-screen bg-[#FFF6EE] pb-36">
      {/* Header */}
      <header className="bg-white border-b border-[#E8D5C0] px-4 py-3">
        <h1 className="font-bold text-[#1C0800]">{hotel?.name ?? 'Menu'}</h1>
        <p className="text-xs text-[#1C0800]/50">Table {tableNumber}</p>
      </header>

      {/* Search + veg filter row */}
      <div className="bg-white border-b border-[#E8D5C0] px-4 py-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-[#FFF6EE] rounded-lg px-3 py-2">
          <Search size={14} className="text-[#1C0800]/40 flex-shrink-0" />
          <input
            type="search"
            placeholder="Search menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[#1C0800] placeholder:text-[#1C0800]/40 outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-[#1C0800]/40">
              <X size={14} />
            </button>
          )}
        </div>
        {showVegToggle && (
          <button
            onClick={() => setVegOnly((v) => !v)}
            className={[
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0',
              vegOnly
                ? 'bg-green-600 text-white'
                : 'bg-[#FFF6EE] text-green-700 border border-green-200',
            ].join(' ')}
          >
            <Leaf size={13} />
            Veg
          </button>
        )}
      </div>

      <CategoryTabs />
      <ProductGrid searchQuery={search} vegOnly={vegOnly} />

      {placeError && (
        <div className="fixed top-4 inset-x-4 z-50 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl shadow">
          {placeError}
        </div>
      )}

      {waiterSent && (
        <div className="fixed top-4 inset-x-4 z-50 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl shadow text-center">
          Staff has been notified — someone will be with you shortly.
        </div>
      )}

      {/* Call waiter FAB — above CartBar */}
      <button
        onClick={() => setModal('waiter')}
        className="fixed bottom-[72px] right-4 z-40 w-12 h-12 bg-white border border-[#E8D5C0] rounded-full shadow-md flex items-center justify-center text-[#1C0800]/60 hover:text-[#1C0800] transition-colors"
        aria-label="Call waiter"
      >
        <Bell size={20} />
      </button>

      {/* CartBar — sits above BottomNav */}
      <CartBar onOpen={() => setModal('cart')} bottomClass="bottom-14" />

      {/* BottomNav */}
      <BottomNav />

      {/* Cart sheet */}
      {modal === 'cart' && (
        <CartSheet onClose={() => setModal('none')} onConfirm={handleCartConfirm} />
      )}

      {/* Guest info prompt */}
      {modal === 'guest-prompt' && (
        <GuestNamePrompt
          requiresPhone={features?.customerIdentification === 'name_mobile'}
          onSubmit={handleGuestSubmit}
        />
      )}

      {/* Placing overlay */}
      {modal === 'placing' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-[#1C0800]">Placing order…</p>
          </div>
        </div>
      )}

      {/* Call waiter bottom sheet */}
      {modal === 'waiter' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal('none')} />
          <div className="relative bg-white rounded-t-2xl pt-4 pb-8 px-4 safe-bottom">
            <div className="w-10 h-1 bg-[#1C0800]/20 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-bold text-[#1C0800] mb-3">Call waiter</h2>
            <div className="space-y-2">
              {WAITER_PRESETS.map((msg) => (
                <button
                  key={msg}
                  onClick={() => void handleWaiterPreset(msg)}
                  className="w-full text-left px-4 py-3 rounded-xl bg-[#FFF6EE] text-sm text-[#1C0800] font-medium border border-[#E8D5C0] active:bg-[#E8D5C0] transition-colors"
                >
                  {msg.replace('[Waiter Request] ', '')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
