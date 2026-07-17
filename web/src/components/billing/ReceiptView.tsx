import { useState, useEffect } from 'react';
import { CheckCircle, Printer, X } from 'lucide-react';
import type { Guest, BillingOrder } from '../../types';
import { fetchReceiptJobs, reprintJob } from '../../api/billing';

interface Props {
  guest: Guest | null;
  tableLabel: string;
  orders: BillingOrder[];
  currencySymbol: string;
  isBulk: boolean;
  onDone: () => void;
}

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentLabel(method?: string | null, split?: { cash: number; upi: number; card: number }): string {
  if (method === 'split' && split) {
    const parts: string[] = [];
    if (split.cash > 0) parts.push(`Cash`);
    if (split.card > 0) parts.push(`Card`);
    if (split.upi > 0) parts.push(`UPI`);
    return parts.join(' + ');
  }
  if (!method) return '—';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function ReceiptView({ guest, tableLabel, orders, currencySymbol, isBulk, onDone }: Props) {
  const [reprintId, setReprintId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  const subtotal = orders.reduce((s, o) => s + (o.subtotal ?? 0), 0);
  const taxTotal = orders.reduce((s, o) => s + (o.taxTotal ?? 0), 0);
  const grandTotal = orders.reduce((s, o) => s + (o.grandTotal ?? 0), 0);

  useEffect(() => {
    const find = async () => {
      try {
        await new Promise(r => setTimeout(r, 800));
        const jobs = await fetchReceiptJobs();
        const match = guest
          ? jobs.find(j => j.guestId === guest._id)
          : jobs[0];
        if (match) setReprintId(match._id);
      } catch { /* silent */ }
    };
    void find();
  }, [guest]);

  async function handlePrint() {
    if (!reprintId || printing) return;
    setPrinting(true);
    setPrintMsg(null);
    try {
      await reprintJob(reprintId);
      setPrintMsg('Sent to printer');
    } catch {
      setPrintMsg('Printer unavailable');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Success header */}
      <div className="flex items-center gap-3 rounded-t-xl bg-green-600 px-5 py-4 text-white">
        <CheckCircle size={22} />
        <div className="flex-1">
          <p className="font-semibold text-sm">{isBulk ? 'Table Billed & Closed' : 'Payment Successful'}</p>
          <p className="text-xs text-green-200">
            {isBulk ? tableLabel : `${guest?.displayLabel ?? 'Guest'} · ${tableLabel}`}
          </p>
        </div>
        <button onClick={onDone} className="rounded-lg p-1 hover:bg-green-500">
          <X size={16} />
        </button>
      </div>

      {/* Receipt body */}
      <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4 font-mono text-xs">
        {/* Header */}
        <div className="text-center border-b border-dashed border-gray-300 pb-3">
          <p className="text-base font-bold text-gray-800 font-sans">{tableLabel}</p>
          {guest && <p className="text-gray-500">{guest.displayLabel}</p>}
          <p className="text-gray-400 text-[10px] mt-1">
            {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>

        {/* Items */}
        <div className="space-y-0.5">
          {orders.flatMap(order =>
            order.items.map((item, i) => (
              <div key={`${order._id}-${i}`} className="flex justify-between text-gray-700">
                <span>{item.productName} ×{item.quantity}</span>
                <span className="tabular-nums">{fmt(item.total ?? item.price * item.quantity, currencySymbol)}</span>
              </div>
            )),
          )}
        </div>

        {/* Totals */}
        <div className="border-t border-dashed border-gray-300 pt-3 space-y-1">
          <div className="flex justify-between text-gray-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{fmt(subtotal, currencySymbol)}</span>
          </div>
          {taxTotal > 0 && (() => {
            const taxRate    = subtotal > 0 ? (taxTotal / subtotal) * 100 : 0;
            const halfRate   = (taxRate / 2).toFixed(1).replace(/\.0$/, '');
            const cgst       = taxTotal / 2;
            const sgst       = taxTotal / 2;
            const roundOff   = grandTotal - subtotal - taxTotal;
            return (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>CGST ({halfRate}%)</span>
                  <span className="tabular-nums">{fmt(cgst, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>SGST ({halfRate}%)</span>
                  <span className="tabular-nums">{fmt(sgst, currencySymbol)}</span>
                </div>
                {Math.abs(roundOff) >= 0.01 && (
                  <div className="flex justify-between text-gray-400">
                    <span>Round Off</span>
                    <span className="tabular-nums">{roundOff > 0 ? '+' : ''}{fmt(roundOff, currencySymbol)}</span>
                  </div>
                )}
              </>
            );
          })()}
          <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
            <span>Grand Total</span>
            <span className="tabular-nums">{fmt(grandTotal, currencySymbol)}</span>
          </div>
        </div>

        {/* Payment info */}
        {guest && (
          <div className="text-gray-500 text-center pt-1 border-t border-dashed border-gray-300">
            <p>Payment: <span className="font-semibold text-gray-700">{paymentLabel(guest.paymentMethod, guest.splitDetails)}</span></p>
            {guest.splitDetails && (
              <div className="mt-1 space-y-0.5 text-[10px]">
                {guest.splitDetails.cash > 0 && <p>Cash: {fmt(guest.splitDetails.cash, currencySymbol)}</p>}
                {guest.splitDetails.card > 0 && <p>Card: {fmt(guest.splitDetails.card, currencySymbol)}</p>}
                {guest.splitDetails.upi > 0 && <p>UPI: {fmt(guest.splitDetails.upi, currencySymbol)}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-gray-100 px-5 py-3 flex gap-2 bg-gray-50">
        {printMsg ? (
          <p className="flex-1 text-center text-xs text-gray-500 py-1">{printMsg}</p>
        ) : (
          <button
            onClick={handlePrint}
            disabled={!reprintId || printing}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-800 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
          >
            <Printer size={15} />
            {printing ? 'Sending…' : 'Print Receipt'}
          </button>
        )}
        <button
          onClick={onDone}
          className="flex-1 rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}
