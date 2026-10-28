// Pure offline-sync rules — no React Native imports, so they can be unit-tested
// under Node (see src/sync/__tests__/offlineRules.test.ts).

// ── Error classification ─────────────────────────────────────────────────────

export type SyncErrorKind = 'retryable' | 'auth' | 'permanent';

export interface ClassifiedError {
  kind: SyncErrorKind;
  code: string;
  reason: string;
}

const INTERNAL_DETAIL = /E11000|mongo|ObjectId|Cast to|stack|\bat \S+ \(|ECONN|ValidationError:/i;

function readableReason(message: string | undefined, fallback: string): string {
  const firstLine = String(message ?? '').split('\n')[0].trim();
  if (!firstLine || INTERNAL_DETAIL.test(firstLine) || /^HTTP \d{3}$/.test(firstLine)) return fallback;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

/** Relies on fetchAPI setting err.status (HTTP status) and err.code. */
export function classifyError(error: unknown): ClassifiedError {
  const status = (error as { status?: number })?.status;
  const code   = String((error as { code?: string })?.code ?? '');
  const name   = (error as { name?: string })?.name;
  const message = String((error as { message?: string })?.message ?? error ?? '');

  if (status === 401 || code === 'SESSION_EXPIRED') {
    return { kind: 'auth', code: 'auth_required', reason: 'Login required to send saved bills.' };
  }
  if (status === 403 && /TRIAL_EXPIRED|PLAN_EXPIRED/.test(code)) {
    return { kind: 'auth', code: 'subscription_expired', reason: 'Subscription expired. Renew to send saved bills.' };
  }
  if (status && (status === 408 || status === 425 || status === 429 || status >= 500)) {
    return { kind: 'retryable', code: `http_${status}`, reason: 'Server temporarily unavailable. Will retry.' };
  }
  if (status && status >= 400 && status < 500) {
    return { kind: 'permanent', code: `http_${status}`, reason: readableReason(message, 'The server refused this bill.') };
  }
  if (name === 'AbortError' || name === 'TimeoutError' || /timed out/i.test(message)) {
    return { kind: 'retryable', code: 'timeout', reason: 'Server took too long to answer. Will retry.' };
  }
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|network request failed|load failed|offline|unreachable/i.test(message)
  ) {
    return { kind: 'retryable', code: 'network', reason: 'No connection to server. Will retry.' };
  }
  return { kind: 'retryable', code: 'unknown', reason: 'Could not send this bill. Will retry.' };
}

// ── What may be queued offline ───────────────────────────────────────────────
// Mirrors web/src/utils/offlineQueue.ts. Wallet, loyalty redemption and online
// payments need the server to check a live balance / gateway, so they are only
// allowed online. (Offline wallet use used to be folded into discountAmount, so
// the server never debited the wallet — a free discount.)

export const OFFLINE_ALLOWED_PAYMENT_METHODS = ['cash', 'card', 'upi', 'split'];
export const OFFLINE_FORBIDDEN_FIELDS = ['walletCustomerId', 'walletAmount', 'useWallet', 'redeemedPoints'];

export class OfflineNotAllowedError extends Error {
  constructor(message: string) { super(message); this.name = 'OfflineNotAllowedError'; }
}

export function assertOfflineQueueable(payload: Record<string, unknown>): void {
  for (const f of OFFLINE_FORBIDDEN_FIELDS) {
    const v = payload[f];
    if (v !== undefined && v !== null && v !== false && v !== 0 && v !== '') {
      throw new OfflineNotAllowedError(
        f === 'redeemedPoints'
          ? 'Loyalty points can only be redeemed while online.'
          : 'Wallet balance can only be used while online.',
      );
    }
  }
  const pm = payload.paymentMethod;
  if (pm !== undefined && !OFFLINE_ALLOWED_PAYMENT_METHODS.includes(String(pm))) {
    throw new OfflineNotAllowedError(`Payment method "${String(pm)}" needs an internet connection.`);
  }
}

// ── Submitting one queued cashier bill ───────────────────────────────────────

export interface CashierSubmitDeps {
  createOrder: (payload: Record<string, unknown>) => Promise<{ _id: unknown; status?: string; orderNumber?: string }>;
  markServed:  (serverId: string) => Promise<unknown>;
  complete:    (serverId: string, paymentMethod: string) => Promise<unknown>;
}

export interface QueuedBill {
  offlineId:   string;
  payload:     Record<string, unknown>;
  afterCreate: { markServed: boolean; complete: boolean };
  serverId?:   string | null;
}

export type SubmitOutcome =
  | { kind: 'synced'; serverId: string; orderNumber: string | null }
  | { kind: SyncErrorKind; code: string; reason: string; serverId: string | null };

/**
 * Sends a queued bill and replays its follow-up steps. Reports 'synced' ONLY
 * when the order exists on the server AND every required step returned success.
 * Retries are safe: the same offlineId makes the server return the existing
 * order (no duplicate, no second stock/wallet movement), and steps already done
 * on the server (served / completed) are skipped.
 */
export async function submitCashierBill(bill: QueuedBill, deps: CashierSubmitDeps): Promise<SubmitOutcome> {
  let order: { _id: unknown; status?: string; orderNumber?: string };
  try {
    order = await deps.createOrder({ ...bill.payload, offlineId: bill.offlineId });
  } catch (err) {
    return { ...classifyError(err), serverId: bill.serverId ?? null };
  }

  const serverId = String(order._id);
  try {
    let status = order.status ?? 'pending';
    if (bill.afterCreate.markServed && !['served', 'completed'].includes(status)) {
      await deps.markServed(serverId);
      status = 'served';
    }
    if (bill.afterCreate.complete && status !== 'completed') {
      await deps.complete(serverId, String(bill.payload.paymentMethod ?? 'cash'));
    }
  } catch (err) {
    const c = classifyError(err);
    return { ...c, serverId, reason: `Saved on server but not closed: ${c.reason}` };
  }
  return { kind: 'synced', serverId, orderNumber: order.orderNumber ?? null };
}
