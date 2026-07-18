import type { QrBill } from '../../types/qr.ts';
import { OrderStatusCard } from './OrderStatusCard.tsx';

interface BillViewProps {
  bill:           QrBill;
  currencySymbol: string;
}

export function BillView({ bill, currencySymbol }: BillViewProps) {
  return (
    <div className="p-4">
      <div className="text-center mb-6">
        <p className="text-sm text-[#1C0800]/60">Table</p>
        <p className="text-2xl font-bold text-[#1C0800]">{bill.displayLabel || bill.tableNumber}</p>
        {bill.isBilled && (
          <span className="inline-block mt-2 text-xs bg-[#E8380D]/10 text-[#E8380D] px-3 py-1 rounded-full font-medium">
            Bill requested
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold text-[#1C0800] mb-3">Your orders</h3>
      {bill.orders.map((order) => (
        <OrderStatusCard key={order._id} order={order} currencySymbol={currencySymbol} />
      ))}

      <div className="bg-white rounded-xl border border-[#E8D5C0] p-4 mt-4 space-y-2">
        <div className="flex justify-between text-sm text-[#1C0800]/70">
          <span>Subtotal</span>
          <span>{currencySymbol}{bill.subtotal.toFixed(2)}</span>
        </div>
        {bill.taxTotal > 0 && (
          <div className="flex justify-between text-sm text-[#1C0800]/70">
            <span>Taxes</span>
            <span>{currencySymbol}{bill.taxTotal.toFixed(2)}</span>
          </div>
        )}
        {bill.loyaltyDiscountAmount != null && bill.loyaltyDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-green-700">
            <span>Loyalty discount</span>
            <span>− {currencySymbol}{bill.loyaltyDiscountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-[#1C0800] pt-2 border-t border-[#E8D5C0]">
          <span>Grand total</span>
          <span>{currencySymbol}{bill.grandTotal.toFixed(2)}</span>
        </div>
        {bill.paymentMethod && (
          <p className="text-xs text-center text-[#1C0800]/50 mt-1">
            Paid via {bill.paymentMethod}
          </p>
        )}
      </div>
    </div>
  );
}
