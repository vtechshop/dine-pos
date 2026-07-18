import { ShoppingCart } from 'lucide-react';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

interface CartBarProps {
  onOpen: () => void;
}

export function CartBar({ onOpen }: CartBarProps) {
  const { totalItems, totalPrice } = useCart();
  const { hotel } = useMenu();
  const symbol = hotel?.currencySymbol ?? '₹';

  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 p-4 bg-gradient-to-t from-[#FFF6EE] to-transparent pointer-events-none">
      <button
        onClick={onOpen}
        className="w-full pointer-events-auto flex items-center justify-between bg-[#E8380D] text-white px-4 py-3 rounded-xl shadow-lg"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="bg-white/20 rounded-md px-1.5 py-0.5 text-xs">{totalItems}</span>
          View cart
        </span>
        <span className="font-bold">{symbol}{totalPrice.toFixed(2)}</span>
      </button>
    </div>
  );
}
