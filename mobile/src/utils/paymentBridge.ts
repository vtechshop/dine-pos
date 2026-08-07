import AsyncStorage from '@react-native-async-storage/async-storage';

// Passes large billing order payloads to PaymentScreen without nav params.
// Cleared immediately after PaymentScreen reads it.
let _pending: Record<string, unknown> | null = null;

export const setPendingOrder = (data: Record<string, unknown>): void => { _pending = data; };
export const getPendingOrder = (): Record<string, unknown> | null => _pending;
export const clearPendingOrder = (): void => { _pending = null; };

// ── UPI crash-gap recovery ────────────────────────────────────────────────────
// Persists UPI success result to AsyncStorage so a confirmed payment is not
// lost if the app is killed between the UPI activity result and the Confirm tap.

const UPI_PENDING_KEY = '@dinepos:upi_pending_payment';

export interface PendingUpiPayment {
  txnId: string;
  amount: number;
  orderRef: string;
  ts: number;
  payload: Record<string, unknown> | null;
}

export const savePendingUpiPayment = async (data: PendingUpiPayment): Promise<void> => {
  try {
    await AsyncStorage.setItem(UPI_PENDING_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal — app still works without persistence
  }
};

export const loadPendingUpiPayment = async (): Promise<PendingUpiPayment | null> => {
  try {
    const raw = await AsyncStorage.getItem(UPI_PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingUpiPayment;
  } catch {
    return null;
  }
};

export const clearPendingUpiPayment = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(UPI_PENDING_KEY);
  } catch {
    // Non-fatal
  }
};
