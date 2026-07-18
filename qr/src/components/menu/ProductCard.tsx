import type { Product } from '@dinepos/shared/types';
import { QuantityStepper } from '@dinepos/shared/components';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';

interface ProductCardProps {
  product:  Product;
  onClick:  (product: Product) => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { addItem, removeItem, setQty, getQty } = useCart();
  const { hotel } = useMenu();
  const qty = getQty(product._id);
  const symbol = hotel?.currencySymbol ?? '₹';

  const isVeg =
    product.isVeg !== undefined
      ? product.isVeg
      : hotel?.businessType === 'veg';

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    addItem({
      productId: product._id,
      name:      product.name,
      price:     product.price,
      isVeg,
    });
  }

  return (
    <div
      className="bg-white rounded-xl border border-[#E8D5C0] overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
      onClick={() => onClick(product)}
    >
      {product.image && (
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-32 object-cover"
          loading="lazy"
        />
      )}
      <div className="p-3">
        <div className="flex items-start gap-2 mb-1">
          {/* Veg/Non-veg indicator */}
          <span
            className={[
              'mt-0.5 w-3.5 h-3.5 border-2 rounded-sm flex-shrink-0 flex items-center justify-center',
              isVeg ? 'border-green-600' : 'border-red-600',
            ].join(' ')}
          >
            <span
              className={[
                'w-1.5 h-1.5 rounded-full',
                isVeg ? 'bg-green-600' : 'bg-red-600',
              ].join(' ')}
            />
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
          {qty === 0 ? (
            <button
              onClick={handleAdd}
              className="text-xs px-3 py-1 bg-[#E8380D] text-white rounded-full font-medium"
            >
              ADD
            </button>
          ) : (
            <QuantityStepper
              quantity={qty}
              min={0}
              size="sm"
              onIncrement={() => setQty(product._id, qty + 1)}
              onDecrement={() => {
                if (qty <= 1) removeItem(product._id);
                else setQty(product._id, qty - 1);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
