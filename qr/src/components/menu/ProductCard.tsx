import type { Product } from '@dinepos/shared/types';
import { QuantityStepper } from '@dinepos/shared/components';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

interface ProductCardProps {
  product: Product;
  onClick: (product: Product) => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { addItem, removeItem, setQty, getQty, simpleLineId } = useCart();
  const { hotel } = useMenu();
  const qty    = getQty(product._id);
  const symbol = hotel?.currencySymbol ?? '₹';

  const isSoldOut = product.isAvailable === false;

  const isVeg =
    product.isVeg !== undefined
      ? product.isVeg
      : hotel?.businessType === 'veg';

  const hasModifiers = (product.modifierGroups ?? []).length > 0;
  const hasVariants  = (product.variants ?? []).length > 0;
  const isComplex    = hasModifiers || hasVariants;

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (isSoldOut) return;
    if (isComplex) {
      onClick(product);
      return;
    }
    addItem({ productId: product._id, name: product.name, price: product.price, modifierTotal: 0, isVeg });
  }

  return (
    <div
      className="relative bg-white rounded-xl border border-[#E8D5C0] overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
      onClick={() => !isSoldOut && onClick(product)}
    >
      {product.image && (
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-32 object-cover"
          loading="lazy"
        />
      )}

      {isSoldOut && (
        <div className="absolute inset-0 bg-white/75 z-10 flex items-center justify-center">
          <span className="bg-[#1C0800]/10 text-[#1C0800]/60 text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
            SOLD OUT
          </span>
        </div>
      )}

      <div className="p-3">
        <div className="flex items-start gap-2 mb-1">
          <span
            className={[
              'mt-0.5 w-3.5 h-3.5 border-2 rounded-sm flex-shrink-0 flex items-center justify-center',
              isVeg ? 'border-green-600' : 'border-red-600',
            ].join(' ')}
          >
            <span className={['w-1.5 h-1.5 rounded-full', isVeg ? 'bg-green-600' : 'bg-red-600'].join(' ')} />
          </span>
          <p className="text-sm font-medium text-[#1C0800] leading-tight">{product.name}</p>
        </div>
        {product.description && (
          <p className="text-xs text-[#1C0800]/60 mb-2 line-clamp-2">{product.description}</p>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm font-semibold text-[#1C0800]">
            {symbol}{product.price.toFixed(2)}
          </span>
          {isSoldOut ? (
            <span className="text-xs text-[#1C0800]/30 font-medium">Unavailable</span>
          ) : qty === 0 ? (
            <button
              onClick={handleAdd}
              className="text-xs px-3 py-1 bg-[#E8380D] text-white rounded-full font-medium"
            >
              ADD
            </button>
          ) : isComplex ? (
            <button
              onClick={(e) => { e.stopPropagation(); onClick(product); }}
              className="flex items-center gap-1.5 rounded-full border border-[#E8380D] px-3 py-1 text-xs font-semibold text-[#E8380D]"
            >
              {qty}× <span className="text-[10px]">Edit</span>
            </button>
          ) : (
            <QuantityStepper
              quantity={qty}
              min={0}
              size="sm"
              onIncrement={() => setQty(simpleLineId(product._id), qty + 1)}
              onDecrement={() => {
                if (qty <= 1) removeItem(simpleLineId(product._id));
                else setQty(simpleLineId(product._id), qty - 1);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
