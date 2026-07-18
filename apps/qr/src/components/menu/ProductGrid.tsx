import { useState } from 'react';
import type { Product } from '@dinepos/shared/types';
import { useMenu } from '../../context/MenuContext.tsx';
import { ProductCard } from './ProductCard.tsx';
import { ProductDetailSheet } from './ProductDetailSheet.tsx';

export function ProductGrid() {
  const { products, activeCategoryId, bestsellerIds } = useMenu();
  const [selected, setSelected] = useState<Product | null>(null);

  const visible = products.filter(
    (p) =>
      p.isAvailable !== false &&
      !p.isDeleted &&
      p.category != null &&
      p.category._id === activeCategoryId,
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 p-4">
        {visible.map((product) => (
          <ProductCard
            key={product._id}
            product={product}
            onClick={setSelected}
          />
        ))}
        {visible.length === 0 && (
          <p className="col-span-2 text-center text-sm text-[#1C0800]/50 py-8">
            No items in this category
          </p>
        )}
      </div>
      {selected && (
        <ProductDetailSheet
          product={selected}
          isBestseller={bestsellerIds.includes(selected._id)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
