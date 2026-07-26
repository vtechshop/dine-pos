import type { CartEntry } from '../../types/qr.ts';
import { QuantityStepper } from '@dinepos/shared/components';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

interface CartItemProps {
  entry: CartEntry;
}

export function CartItem({ entry }: CartItemProps) {
  const { setQty, removeItem } = useCart();
  const { hotel } = useMenu();
  const symbol = hotel?.currencySymbol ?? '₹';
  const unitPrice = entry.price + entry.modifierTotal;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#E8D5C0] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1C0800] truncate">{entry.name}</p>
        {entry.variantName && (
          <p className="text-xs text-[#1C0800]/50 mt-0.5">{entry.variantName}</p>
        )}
        {(entry.selectedModifiers ?? []).map(m => (
          <p key={m.modifierOptionId} className="text-xs text-[#1C0800]/50">
            + {m.modifierOptionName}{m.modifierPrice > 0 ? ` (+${symbol}${m.modifierPrice})` : ''}
          </p>
        ))}
        {entry.notes && (
          <p className="text-xs text-[#1C0800]/40 mt-0.5 italic truncate">{entry.notes}</p>
        )}
        <p className="text-sm font-semibold text-[#E8380D] mt-1">
          {symbol}{(unitPrice * entry.quantity).toFixed(2)}
        </p>
      </div>
      <QuantityStepper
        quantity={entry.quantity}
        min={0}
        size="sm"
        onIncrement={() => setQty(entry.cartLineId, entry.quantity + 1)}
        onDecrement={() => {
          if (entry.quantity <= 1) removeItem(entry.cartLineId);
          else setQty(entry.cartLineId, entry.quantity - 1);
        }}
      />
    </div>
  );
}
