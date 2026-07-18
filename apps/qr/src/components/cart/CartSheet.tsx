import { useRef } from 'react';
import { X } from 'lucide-react';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';
import { CartItem } from './CartItem.tsx';

interface CartSheetProps {
  onClose:   () => void;
  onConfirm: () => void;
}

export function CartSheet({ onClose, onConfirm }: CartSheetProps) {
  const { items, totalPrice, totalItems } = useCart();
  const { hotel } = useMenu();
  const overlayRef = useRef<HTMLDivElement>(null);
  const symbol = hotel?.currencySymbol ?? '₹';

  if (totalItems === 0) {
    onClose();
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/50 flex items-end"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full bg-[#FFF6EE] rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8D5C0]">
          <h2 className="font-semibold text-[#1C0800]">Your cart ({totalItems} items)</h2>
          <button onClick={onClose} className="p-1 text-[#1C0800]/50">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {items.map((entry) => (
            <CartItem key={entry.productId} entry={entry} />
          ))}
        </div>

        <div className="px-5 py-4 border-t border-[#E8D5C0] bg-[#FFF6EE]">
          <div className="flex justify-between text-sm font-semibold text-[#1C0800] mb-4">
            <span>Total</span>
            <span>{symbol}{totalPrice.toFixed(2)}</span>
          </div>
          <button
            onClick={onConfirm}
            className="w-full py-3 bg-[#E8380D] text-white rounded-xl font-semibold"
          >
            Place order
          </button>
        </div>
      </div>
    </div>
  );
}
