// Passes large billing order payloads to PaymentScreen without nav params.
// Cleared immediately after PaymentScreen reads it.
let _pending: Record<string, unknown> | null = null;

export const setPendingOrder = (data: Record<string, unknown>): void => { _pending = data; };
export const getPendingOrder = (): Record<string, unknown> | null => _pending;
export const clearPendingOrder = (): void => { _pending = null; };
