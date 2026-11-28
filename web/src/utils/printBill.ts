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
  items: {
    productName: string; quantity: number; price: number; total: number;
    // Batch 3: what was actually ordered on this line
    variantName?: string;
    selectedModifiers?: { modifierOptionName: string; modifierPrice?: number }[];
    notes?: string;
  }[];
  subtotal: number;
  taxTotal: number;
  discountAmount?: number;
  // Batch 3 (3A): every amount that takes the bill from subtotal + tax to what is payable, so
  // the printed lines add up exactly (they were missing, so a coupon / voucher bill didn't add up).
  couponDiscount?: number;
  loyaltyDiscount?: number;
  paymentDiscount?: number;     // discount given at payment
  giftVoucherAmount?: number;   // tender (prepaid), not a discount
  walletAmount?: number;        // tender (prepaid), not a discount
  deliveryFee?: number;
  amountSettled?: number;       // paid so far (payment ledger)
  grandTotal: number;
  paymentMethod?: string | null;
  status: string;
  /** Set when paid at the counter before the order is closed */
  paymentTime?: string | null;
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
  const paid = bill.status === 'completed' || !!bill.paymentTime;
  const tenders   = (bill.giftVoucherAmount || 0) + (bill.walletAmount || 0);
  const billValue = bill.grandTotal + tenders;                 // what the food cost after discounts
  const settled   = bill.amountSettled || 0;
  const partPaid  = !paid && settled > 0.005 && settled < bill.grandTotal - 0.005;
  const where = bill.isParcel ? 'Takeaway' : bill.tableNumber ? `Table ${bill.tableNumber}` : '';

  const rows = bill.items.map(i => `
    <tr><td colspan="3">${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td></tr>
    ${(i.selectedModifiers ?? []).map(m => `<tr class="sub"><td colspan="3">+ ${esc(m.modifierOptionName)}${m.modifierPrice ? ` ${money(m.modifierPrice)}` : ''}</td></tr>`).join('')}
    ${i.notes ? `<tr class="sub"><td colspan="3">Note: ${esc(i.notes)}</td></tr>` : ''}
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
    ${bill.couponDiscount ? `<tr><td>Coupon</td><td class="r">-${money(bill.couponDiscount)}</td></tr>` : ''}
    ${bill.loyaltyDiscount ? `<tr><td>Loyalty</td><td class="r">-${money(bill.loyaltyDiscount)}</td></tr>` : ''}
    ${bill.paymentDiscount ? `<tr><td>Discount at payment</td><td class="r">-${money(bill.paymentDiscount)}</td></tr>` : ''}
    ${bill.deliveryFee ? `<tr><td>Delivery</td><td class="r">${money(bill.deliveryFee)}</td></tr>` : ''}
    ${tenders > 0 ? `<tr><td>Bill total</td><td class="r">${money(billValue)}</td></tr>` : ''}
    ${bill.giftVoucherAmount ? `<tr><td>Gift voucher</td><td class="r">-${money(bill.giftVoucherAmount)}</td></tr>` : ''}
    ${bill.walletAmount ? `<tr><td>Wallet</td><td class="r">-${money(bill.walletAmount)}</td></tr>` : ''}
    <tr class="total"><td>${tenders > 0 ? 'TO PAY' : 'TOTAL'}</td><td class="r">${money(bill.grandTotal)}</td></tr>
    ${partPaid ? `<tr><td>Paid</td><td class="r">${money(settled)}</td></tr><tr class="b"><td>Balance due</td><td class="r">${money(bill.grandTotal - settled)}</td></tr>` : ''}
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
