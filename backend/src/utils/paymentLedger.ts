/**
 * paymentLedger.ts — records money movements against orders (Phase 5 · Batch 2 · 2B).
 *
 * Every pathway that takes or returns money calls recordEntries(); nothing else writes
 * Order.amountSettled or sets the "fully settled" Order.paymentTime.
 *
 * Rules (owner-approved):
 *  - each payment is its own PaymentEntry with its own paidAt (split = several entries,
 *    partial payment = an entry for part of the balance);
 *  - an entry is recorded at most once (unique idempotencyKey per hotel);
 *  - Order.paymentTime = when the order became fully settled; set once, never overwritten;
 *  - outstanding = paymentTime ? 0 : grandTotal − amountSettled (exact paise);
 *  - refunds never change amountSettled (they are reported separately).
 */
import mongoose, { ClientSession } from 'mongoose';
import Order from '../models/Order';
import PaymentEntry, { PaymentEntryMethod, PaymentEntryType } from '../models/PaymentEntry';

export const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
/** Half a paisa — tolerance for comparisons of 2-decimal rupee amounts. */
export const PAISE = 0.005;

export interface SettleableOrder {
  _id?: unknown;
  grandTotal?: number | null;
  amountSettled?: number | null;
  paymentTime?: Date | string | null;
  status?: string | null;
}

/** Amount still owed on an order (0 for cancelled or fully settled orders). */
export function outstandingOf(o: SettleableOrder): number {
  if (!o || o.status === 'cancelled' || o.paymentTime) return 0;
  return r2(Math.max(0, (Number(o.grandTotal) || 0) - (Number(o.amountSettled) || 0)));
}

export interface EntryInput {
  type:           PaymentEntryType;
  method:         PaymentEntryMethod;
  amount:         number;
  paidAt:         Date;
  source:         string;
  allocations:    Array<{ orderId: mongoose.Types.ObjectId | string; amount: number }>;
  idempotencyKey: string;
  sessionId?:     mongoose.Types.ObjectId | string | null;
  guestId?:       mongoose.Types.ObjectId | string | null;
  paymentId?:     mongoose.Types.ObjectId | string | null;
  reference?:     string;
  reason?:        string;
  recordedBy?:    string;
  reversesEntryId?: mongoose.Types.ObjectId | string | null;   // type 'reversal' only
}

export interface RecordResult { inserted: number; duplicates: string[] }

/**
 * Inserts the entries not recorded yet (by idempotencyKey) and applies their allocations
 * to the orders, in one transaction. Pass `session` to join an existing transaction.
 * Entries with amount ≤ 0 are skipped.
 */
export async function recordEntries(
  hotelId: string | mongoose.Types.ObjectId,
  entries: EntryInput[],
  opts: { session?: ClientSession } = {},
): Promise<RecordResult> {
  const hid = new mongoose.Types.ObjectId(String(hotelId));
  const run = async (s: ClientSession): Promise<RecordResult> => {
    let inserted = 0;
    const duplicates: string[] = [];
    const settled = new Map<string, Date>();
    const reopened = new Set<string>();
    for (const e of entries) {
      const amount = r2(e.amount);
      if (!(amount > 0)) continue;
      if (await PaymentEntry.exists({ hotelId: hid, idempotencyKey: e.idempotencyKey }).session(s)) {
        duplicates.push(e.idempotencyKey);
        continue;
      }
      const allocations = e.allocations
        .map(a => ({ orderId: new mongoose.Types.ObjectId(String(a.orderId)), amount: r2(a.amount) }))
        .filter(a => a.amount > 0);
      await PaymentEntry.create([{
        hotelId: hid, type: e.type, method: e.method, amount, paidAt: e.paidAt, source: e.source,
        allocations,
        sessionId: e.sessionId ? new mongoose.Types.ObjectId(String(e.sessionId)) : null,
        guestId:   e.guestId   ? new mongoose.Types.ObjectId(String(e.guestId))   : null,
        paymentId: e.paymentId ? new mongoose.Types.ObjectId(String(e.paymentId)) : null,
        reference: e.reference ?? '', reason: e.reason ?? '', recordedBy: e.recordedBy ?? '',
        idempotencyKey: e.idempotencyKey,
        reversesEntryId: e.reversesEntryId ? new mongoose.Types.ObjectId(String(e.reversesEntryId)) : null,
      }], { session: s });
      inserted++;
      // A tip names its order for reference only: it is not part of the bill and settles nothing.
      if (e.type === 'tip') continue;
      for (const a of allocations) {
        if (e.type === 'reversal') {
          // Batch 3 (3E): undo what the reversed entry settled; the order is owed again.
          await Order.updateOne(
            { _id: a.orderId, hotelId: hid },
            { $inc: { amountSettled: -a.amount }, $set: { ledger: true } },
            { session: s },
          );
          reopened.add(String(a.orderId));
          continue;
        }
        if (e.type === 'refund') {
          await Order.updateOne({ _id: a.orderId, hotelId: hid }, { $set: { ledger: true } }, { session: s });
          continue;
        }
        await Order.updateOne(
          { _id: a.orderId, hotelId: hid },
          { $inc: { amountSettled: a.amount, ...(e.type === 'write_off' ? { writeOffAmount: a.amount } : {}) }, $set: { ledger: true } },
          { session: s },
        );
        const prev = settled.get(String(a.orderId));
        if (!prev || prev < e.paidAt) settled.set(String(a.orderId), e.paidAt);
      }
    }
    // "Fully settled" time — set once, never overwritten, never on cancelled orders.
    for (const [orderId, paidAt] of settled) {
      await Order.updateOne(
        {
          _id: new mongoose.Types.ObjectId(orderId), hotelId: hid, paymentTime: null, status: { $ne: 'cancelled' },
          $expr: { $gte: [{ $add: [{ $ifNull: ['$amountSettled', 0] }, PAISE] }, '$grandTotal'] },
        },
        { $set: { paymentTime: paidAt } },
        { session: s },
      );
    }
    // Orders a reversal left not fully settled are owed again: clear the "fully settled" time.
    if (reopened.size) {
      await Order.updateMany(
        {
          _id: { $in: [...reopened].map(id => new mongoose.Types.ObjectId(id)) }, hotelId: hid,
          $expr: { $lt: [{ $add: [{ $ifNull: ['$amountSettled', 0] }, PAISE] }, '$grandTotal'] },
        },
        { $set: { paymentTime: null } },
        { session: s },
      );
    }
    return { inserted, duplicates };
  };

  if (opts.session) return run(opts.session);
  const s = await mongoose.startSession();
  try {
    let out: RecordResult = { inserted: 0, duplicates: [] };
    await s.withTransaction(async () => { out = await run(s); });
    return out;
  } catch (err: any) {
    // A simultaneous request recorded the same key first (unique index): nothing to add.
    if (err?.code === 11000) return { inserted: 0, duplicates: entries.map(e => e.idempotencyKey) };
    throw err;
  } finally {
    await s.endSession();
  }
}

/**
 * Records a successful gateway (Razorpay) payment against its order — once per gateway
 * Payment document, whichever pathway sees it first (QR verify, webhook, /payments/verify,
 * completion). Amount is the Payment amount (paise → rupees). Errors are logged, not thrown:
 * the gateway payment itself already succeeded.
 */
export async function recordGatewayPayment(
  hotelId: string | mongoose.Types.ObjectId,
  pay: { _id: unknown; amount?: number; gatewayTransactionId?: string; updatedAt?: Date },
  orderId: string | mongoose.Types.ObjectId,
  source: string,
  paidAt: Date = new Date(),
): Promise<void> {
  const amount = r2((Number(pay.amount) || 0) / 100);
  if (!(amount > 0)) return;
  try {
    await recordEntries(hotelId, [{
      type: 'payment', method: 'online', amount, paidAt, source,
      allocations: [{ orderId, amount }], paymentId: String(pay._id),
      reference: pay.gatewayTransactionId ?? '', recordedBy: 'gateway',
      idempotencyKey: `gw:${pay._id}`,
    }]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ledger] gateway payment not recorded', { paymentId: String(pay._id), error: String(err) });
  }
}

/** Ledger method for an order payment method ('upi_qr' → 'upi', 'razorpay' → 'online', …). */
export function ledgerMethod(paymentMethod: string | null | undefined): PaymentEntryMethod {
  switch (paymentMethod) {
    case 'cash': return 'cash';
    case 'card': return 'card';
    case 'upi': case 'upi_intent': case 'upi_qr': case 'upi_collect': return 'upi';
    case 'razorpay': return 'online';
    default: return 'other';
  }
}

export interface MoneyPart { method: PaymentEntryMethod; amount: number }

/**
 * Money parts for an amount paid with `paymentMethod` ('split' uses splitDetails).
 * Returns null when a split does not add up to the amount to the paisa.
 */
export function moneyParts(
  paymentMethod: string,
  amount: number,
  splitDetails?: { cash?: number; upi?: number; card?: number } | null,
): MoneyPart[] | null {
  if (paymentMethod === 'split') {
    const parts: MoneyPart[] = [
      { method: 'cash' as const, amount: r2(splitDetails?.cash) },
      { method: 'upi'  as const, amount: r2(splitDetails?.upi) },
      { method: 'card' as const, amount: r2(splitDetails?.card) },
    ].filter(p => p.amount > 0);
    const sum = r2(parts.reduce((t, p) => t + p.amount, 0));
    if (parts.some(p => p.amount < 0) || Math.abs(sum - r2(amount)) > PAISE) return null;
    return parts;
  }
  return [{ method: ledgerMethod(paymentMethod), amount: r2(amount) }];
}

/**
 * Allocates `amount` over orders in sequence (each up to its remaining due), mutating the
 * remaining dues. Returns the allocations and any amount left over.
 */
export function allocateSequential(
  dues: Array<{ orderId: mongoose.Types.ObjectId | string; due: number }>,
  amount: number,
): { allocations: Array<{ orderId: mongoose.Types.ObjectId | string; amount: number }>; left: number } {
  let left = r2(amount);
  const allocations: Array<{ orderId: mongoose.Types.ObjectId | string; amount: number }> = [];
  for (const d of dues) {
    if (left <= 0) break;
    const take = r2(Math.min(d.due, left));
    if (take <= 0) continue;
    allocations.push({ orderId: d.orderId, amount: take });
    d.due = r2(d.due - take);
    left = r2(left - take);
  }
  return { allocations, left };
}

/**
 * Entries that settle a guest / table bill: discounts first, then tenders, then money,
 * each allocated in sequence over the orders' outstanding amounts.
 */
export function settlementEntries(args: {
  dues: Array<{ orderId: mongoose.Types.ObjectId | string; due: number }>;
  discounts: MoneyPart[];      // e.g. loyalty, complimentary
  tenders: Array<MoneyPart & { reference?: string }>;   // voucher, wallet
  money: MoneyPart[];          // cash / upi / card parts
  base: Omit<EntryInput, 'type' | 'method' | 'amount' | 'allocations' | 'idempotencyKey'>;
  keyBase: string;
}): EntryInput[] {
  const dues = args.dues.map(d => ({ ...d, due: r2(d.due) }));
  const out: EntryInput[] = [];
  const add = (type: PaymentEntryType, p: MoneyPart & { reference?: string }, kind: string) => {
    if (!(r2(p.amount) > 0)) return;
    const { allocations } = allocateSequential(dues, p.amount);
    out.push({
      ...args.base, type, method: p.method, amount: r2(p.amount), allocations,
      reference: p.reference ?? args.base.reference, idempotencyKey: `${args.keyBase}:${kind}:${p.method}`,
    });
  };
  args.discounts.forEach(p => add('discount', p, 'discount'));
  args.tenders.forEach(p => add('payment', p, 'tender'));
  args.money.forEach(p => add('payment', p, 'money'));
  return out;
}
