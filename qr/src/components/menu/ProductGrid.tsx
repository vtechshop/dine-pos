import { useState } from 'react';
import type { Product } from '@dinepos/shared/types';
import { useMenu } from '../../context/MenuContext.tsx';
import { ProductCard } from './ProductCard.tsx';
import { ProductDetailSheet } from './ProductDetailSheet.tsx';

interface ProductGridProps {
  searchQuery: string;
  vegOnly:     boolean;
}

export function ProductGrid({ searchQuery, vegOnly }: ProductGridProps) {
  const { products, activeCategoryId, bestsellerIds, hotel } = useMenu();
  const [selected, setSelected] = useState<Product | null>(null);

  const q = searchQuery.toLowerCase();

  const visible = products.filter((p) => {
    if (p.isDeleted) return false;
    if (p.category == null || p.category._id !== activeCategoryId) return false;

    if (vegOnly) {
      const pIsVeg = p.isVeg !== undefined ? p.isVeg : hotel?.businessType === 'veg';
      if (!pIsVeg) return false;
    }

    if (q) {
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description ?? '').toLowerCase().includes(q);
      if (!nameMatch && !descMatch) return false;
    }

    return true;
  });

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
            {q ? 'No items match your search' : 'No items in this category'}
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
