/**
 * Print a bill from the browser (80 mm receipt layout) through the printer the PC
 * has installed. Works for any order, paid or not — the print server only prints
 * receipts at payment time, so this covers bills before payment and re-prints.
 */

export interface PrintableBill {
  orderNumber: string;
  createdAt: string;
  customerName?: string;
  tableNumber?: string;
  isParcel?: boolean;
  items: { productName: string; quantity: number; price: number; total: number }[];
  subtotal: number;
  taxTotal: number;
  discountAmount?: number;
  grandTotal: number;
  paymentMethod?: string | null;
  status: string;
}

export interface BillHeader {
  hotelName?: string;
  address?: string;
  phone?: string;
  gstNumber?: string;
  footerText?: string;
  currencySymbol?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function billHtml(bill: PrintableBill, h: BillHeader): string {
  const sym = h.currencySymbol ?? '₹';
  const money = (n: number) => `${sym}${(Math.round(n * 100) / 100).toFixed(2)}`;
  const when = new Date(bill.createdAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const paid = bill.status === 'completed';
  const where = bill.isParcel ? 'Takeaway' : bill.tableNumber ? `Table ${bill.tableNumber}` : '';

  const rows = bill.items.map(i => `
    <tr><td colspan="3">${esc(i.productName)}</td></tr>
    <tr class="sub"><td>${i.quantity} × ${money(i.price)}</td><td></td><td class="r">${money(i.total)}</td></tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(bill.orderNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 72mm; font: 12px/1.35 'Courier New', monospace; color: #000; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
  h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
  .muted { font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  tr.sub td { font-size: 11px; }
  .total td { font-size: 14px; font-weight: bold; padding-top: 3px; }
  .tag { display: inline-block; border: 1px solid #000; padding: 1px 6px; margin-top: 4px; font-weight: bold; }
</style></head><body>
  <h1>${esc(h.hotelName || 'Bill')}</h1>
  ${h.address ? `<div class="c muted">${esc(h.address)}</div>` : ''}
  ${h.phone ? `<div class="c muted">Ph: ${esc(h.phone)}</div>` : ''}
  ${h.gstNumber ? `<div class="c muted">GSTIN: ${esc(h.gstNumber)}</div>` : ''}
  <hr>
  <div>Bill: <span class="b">${esc(bill.orderNumber)}</span></div>
  <div>${esc(when)}</div>
  ${where ? `<div>${esc(where)}</div>` : ''}
  ${bill.customerName ? `<div>Customer: ${esc(bill.customerName)}</div>` : ''}
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="r">${money(bill.subtotal)}</td></tr>
    <tr><td>Tax</td><td class="r">${money(bill.taxTotal)}</td></tr>
    ${bill.discountAmount ? `<tr><td>Discount</td><td class="r">-${money(bill.discountAmount)}</td></tr>` : ''}
    <tr class="total"><td>TOTAL</td><td class="r">${money(bill.grandTotal)}</td></tr>
  </table>
  <div class="c"><span class="tag">${paid ? `PAID${bill.paymentMethod ? ' · ' + esc(String(bill.paymentMethod).toUpperCase()) : ''}` : 'NOT PAID'}</span></div>
  <hr>
  <div class="c muted">${esc(h.footerText || 'Thank you! Visit again.')}</div>
</body></html>`;
}

/** Opens the system print dialog for this bill (hidden iframe, so no pop-up blockers). */
export function printBill(bill: PrintableBill, header: BillHeader): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(billHtml(bill, header));
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow!.onafterprint = done;
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Some browsers don't fire afterprint for iframes — clean up anyway
    setTimeout(() => frame.remove(), 60_000);
  }, 50);
}
