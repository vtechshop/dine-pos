import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { GuestInfo, QrOrder } from '../types/qr.ts';

interface GuestState {
  // Token stored as qr_guest_token_<hotelId>_<tableId>
  guestToken:    string | null;
  guestInfo:     GuestInfo | null;
  placedOrders:  QrOrder[];
  // True after first successful placeOrder call in this session
  hasOrdered:    boolean;
}

interface GuestContextValue extends GuestState {
  setGuestToken:   (token: string) => void;
  clearGuestToken: () => void;
  setGuestInfo:    (info: GuestInfo) => void;
  addPlacedOrder:  (order: QrOrder) => void;
  clearSession:    () => void;
  storageKey:      string;
}

const GuestContext = createContext<GuestContextValue | null>(null);

function makeStorageKey(hotelId: string, tableId: string) {
  return `qr_guest_token_${hotelId}_${tableId}`;
}

export function GuestProvider({
  hotelId,
  tableId,
  children,
}: {
  hotelId:  string;
  tableId:  string;
  children: ReactNode;
}) {
  const storageKey = makeStorageKey(hotelId, tableId);

  const [state, setState] = useState<GuestState>(() => ({
    guestToken:   sessionStorage.getItem(storageKey),
    guestInfo:    null,
    placedOrders: [],
    hasOrdered:   false,
  }));

  // Keep sessionStorage in sync when token changes
  useEffect(() => {
    if (state.guestToken) {
      sessionStorage.setItem(storageKey, state.guestToken);
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [state.guestToken, storageKey]);

  const setGuestToken = useCallback((token: string) => {
    setState((prev) => ({ ...prev, guestToken: token }));
  }, []);

  const clearGuestToken = useCallback(() => {
    setState((prev) => ({ ...prev, guestToken: null }));
  }, []);

  const setGuestInfo = useCallback((info: GuestInfo) => {
    setState((prev) => ({ ...prev, guestInfo: info }));
  }, []);

  const addPlacedOrder = useCallback((order: QrOrder) => {
    setState((prev) => ({
      ...prev,
      placedOrders: [...prev.placedOrders, order],
      hasOrdered:   true,
    }));
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setState({ guestToken: null, guestInfo: null, placedOrders: [], hasOrdered: false });
  }, [storageKey]);

  return (
    <GuestContext.Provider
      value={{
        ...state,
        storageKey,
        setGuestToken,
        clearGuestToken,
        setGuestInfo,
        addPlacedOrder,
        clearSession,
      }}
    >
      {children}
    </GuestContext.Provider>
  );
}

export function useGuest(): GuestContextValue {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error('useGuest must be used inside <GuestProvider>');
  return ctx;
}
