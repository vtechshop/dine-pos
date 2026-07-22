import { useState, useEffect } from 'react';
import { CheckCircle, Printer, X } from 'lucide-react';
import type { Guest, BillingOrder } from '../../types';
import { fetchReceiptJobs, reprintJob } from '../../api/billing';

interface Props {
  guest: Guest | null;
  sessionId: string;
  tableLabel: string;
  orders: BillingOrder[];
  currencySymbol: string;
  isBulk: boolean;
  onDone: () => void;
}

type PrinterStatus = 'checking' | 'ready' | 'queued' | 'not_found';

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

export function ReceiptView({ guest, sessionId, tableLabel, orders, currencySymbol, isBulk, onDone }: Props) {
  const [reprintId,     setReprintId]     = useState<string | null>(null);
  const [printing,      setPrinting]      = useState(false);
  const [printMsg,      setPrintMsg]      = useState<string | null>(null);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>('checking');
  const [retryCount,    setRetryCount]    = useState(0);

  const subtotal   = orders.reduce((s, o) => s + (o.subtotal ?? 0), 0);
  const taxTotal   = orders.reduce((s, o) => s + (o.taxTotal ?? 0), 0);
  const grandTotal = orders.reduce((s, o) => s + (o.grandTotal ?? 0), 0);

  useEffect(() => {
    setPrinterStatus('checking');
    let cancelled = false;
    const find = async () => {
      try {
        await new Promise(r => setTimeout(r, 800));
        if (cancelled) return;
        const jobs = await fetchReceiptJobs();
        if (cancelled) return;
        const match = guest
          ? jobs.find(j => j.guestId === guest._id)
          : jobs.find(j => j.sessionId === sessionId);
        if (match) {
          setReprintId(match._id);
          setPrinterStatus(match.status === 'pending' ? 'queued' : 'ready');
        } else {
          setPrinterStatus('not_found');
        }
      } catch {
        if (cancelled) return;
        setPrinterStatus('not_found');
      }
    };
    void find();
    return () => { cancelled = true; };
  }, [guest, sessionId, retryCount]);

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

  function handleRetry() {
    setPrintMsg(null);
    setReprintId(null);
    setRetryCount(c => c + 1);
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
      <div className="flex-1 overflow-y-auto bg-canvas px-5 py-4 space-y-4 font-mono text-xs">
        {/* Header */}
        <div className="text-center border-b border-dashed border-border pb-3">
          <p className="text-base font-bold text-ink font-sans">{tableLabel}</p>
          {guest && <p className="text-ink/50">{guest.displayLabel}</p>}
          <p className="text-ink/40 text-[10px] mt-1">
            {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>

        {/* Items */}
        <div className="space-y-0.5">
          {orders.flatMap(order =>
            order.items.map((item, i) => (
              <div key={`${order._id}-${i}`} className="flex justify-between text-ink/70">
                <span>{item.productName} ×{item.quantity}</span>
                <span className="tabular-nums">{fmt(item.total ?? item.price * item.quantity, currencySymbol)}</span>
              </div>
            )),
          )}
        </div>

        {/* Totals */}
        <div className="border-t border-dashed border-border pt-3 space-y-1">
          <div className="flex justify-between text-ink/50">
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
                <div className="flex justify-between text-ink/50">
                  <span>CGST ({halfRate}%)</span>
                  <span className="tabular-nums">{fmt(cgst, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-ink/50">
                  <span>SGST ({halfRate}%)</span>
                  <span className="tabular-nums">{fmt(sgst, currencySymbol)}</span>
                </div>
                {Math.abs(roundOff) >= 0.01 && (
                  <div className="flex justify-between text-ink/40">
                    <span>Round Off</span>
                    <span className="tabular-nums">{roundOff > 0 ? '+' : ''}{fmt(roundOff, currencySymbol)}</span>
                  </div>
                )}
              </>
            );
          })()}
          <div className="flex justify-between text-base font-bold text-ink pt-1 border-t border-border">
            <span>Grand Total</span>
            <span className="tabular-nums">{fmt(grandTotal, currencySymbol)}</span>
          </div>
        </div>

        {/* Payment info */}
        {guest && (
          <div className="text-ink/50 text-center pt-1 border-t border-dashed border-border">
            <p>Payment: <span className="font-semibold text-ink/70">{paymentLabel(guest.paymentMethod, guest.splitDetails)}</span></p>
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
      <div className="border-t border-border px-5 py-3 flex flex-col gap-2 bg-mist">
        {/* Printer status banners */}
        {printerStatus === 'queued' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Printer offline — receipt queued. It will print automatically when the printer reconnects.
          </div>
        )}
        {printerStatus === 'not_found' && !printMsg && (
          <div className="rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink/60">
            Receipt job not found. Check printer connection and tap Retry.
          </div>
        )}

        <div className="flex gap-2">
          {printMsg ? (
            <p className="flex-1 text-center text-xs text-ink/50 py-1">{printMsg}</p>
          ) : printerStatus === 'queued' ? (
            <div className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 py-2.5 text-sm font-medium text-amber-700">
              <Printer size={15} />
              Queued for printing
            </div>
          ) : printerStatus === 'not_found' ? (
            <button
              onClick={handleRetry}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-canvas py-2.5 text-sm font-medium text-ink/60 transition-colors hover:bg-mist"
            >
              <Printer size={15} />
              Retry
            </button>
          ) : (
            <button
              onClick={handlePrint}
              disabled={printerStatus === 'checking' || !reprintId || printing}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-40"
            >
              <Printer size={15} />
              {printing ? 'Sending…' : printerStatus === 'checking' ? 'Checking…' : 'Print Receipt'}
            </button>
          )}
          <button
            onClick={onDone}
            className="flex-1 rounded-lg border border-border bg-canvas py-2.5 text-sm font-medium text-ink/70 transition-colors hover:bg-mist"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
