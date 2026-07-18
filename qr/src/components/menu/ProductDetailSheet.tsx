import { useEffect, useRef, useState } from 'react';
import type { Product } from '@dinepos/shared/types';
import { X } from 'lucide-react';
import { QuantityStepper } from '@dinepos/shared/components';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

interface ProductDetailSheetProps {
  product:      Product;
  isBestseller: boolean;
  onClose:      () => void;
}

export function ProductDetailSheet({ product, isBestseller, onClose }: ProductDetailSheetProps) {
  const { addItem, setQty, removeItem, getQty } = useCart();
  const { hotel } = useMenu();
  const [notes, setNotes] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const symbol = hotel?.currencySymbol ?? '₹';
  const qty = getQty(product._id);

  const isVeg =
    product.isVeg !== undefined
      ? product.isVeg
      : hotel?.businessType === 'veg';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleAddWithNotes() {
    addItem({ productId: product._id, name: product.name, price: product.price, isVeg }, 1, notes);
    onClose();
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/50 flex items-end"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full bg-[#FFF6EE] rounded-t-2xl max-h-[85vh] overflow-y-auto">
        {product.image && (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-48 object-cover"
          />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-2">
              <span
                className={[
                  'mt-1 w-3.5 h-3.5 border-2 rounded-sm flex-shrink-0 flex items-center justify-center',
                  isVeg ? 'border-green-600' : 'border-red-600',
                ].join(' ')}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-[#1C0800]">{product.name}</h2>
                {isBestseller && (
                  <span className="text-xs bg-[#E8380D]/10 text-[#E8380D] px-2 py-0.5 rounded-full font-medium">
                    Bestseller
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-[#1C0800]/50">
              <X size={20} />
            </button>
          </div>

          {product.description && (
            <p className="text-sm text-[#1C0800]/70 mb-4">{product.description}</p>
          )}

          <p className="text-xl font-bold text-[#1C0800] mb-4">
            {symbol}{product.price.toFixed(2)}
          </p>

          <label className="block text-xs font-medium text-[#1C0800]/60 mb-1">
            Special instructions (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. No onions, extra spicy…"
            rows={2}
            className="w-full text-sm border border-[#E8D5C0] rounded-lg px-3 py-2 bg-white text-[#1C0800] resize-none focus:outline-none focus:ring-1 focus:ring-[#E8380D]"
          />

          <div className="mt-4 flex items-center gap-3">
            {qty === 0 ? (
              <button
                onClick={handleAddWithNotes}
                className="flex-1 py-3 bg-[#E8380D] text-white rounded-xl font-semibold"
              >
                Add to cart — {symbol}{product.price.toFixed(2)}
              </button>
            ) : (
              <>
                <QuantityStepper
                  quantity={qty}
                  min={0}
                  size="md"
                  onIncrement={() => setQty(product._id, qty + 1)}
                  onDecrement={() => {
                    if (qty <= 1) removeItem(product._id);
                    else setQty(product._id, qty - 1);
                  }}
                />
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-[#E8380D] text-white rounded-xl font-semibold"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
