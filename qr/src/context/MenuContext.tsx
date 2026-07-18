import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Category, FeatureFlags, Product } from '@dinepos/shared/types';
import { fetchMenu, type MenuResponse } from '../api/menu.ts';

interface HotelInfo {
  _id:             string;
  name:            string;
  currencySymbol:  string;
  businessType:    'veg' | 'non-veg' | 'both';
}

interface MenuState {
  loading:       boolean;
  error:         string | null;
  hotel:         HotelInfo | null;
  features:      FeatureFlags | null;
  categories:    Category[];
  products:      Product[];
  bestsellerIds: string[];
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string) => void;
}

const MenuContext = createContext<MenuState | null>(null);

export function MenuProvider({
  hotelId,
  children,
}: {
  hotelId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<Omit<MenuState, 'setActiveCategoryId'>>({
    loading:          true,
    error:            null,
    hotel:            null,
    features:         null,
    categories:       [],
    products:         [],
    bestsellerIds:    [],
    activeCategoryId: null,
  });

  useEffect(() => {
    if (!hotelId) return;

    fetchMenu(hotelId)
      .then((data: MenuResponse) => {
        setState((prev) => ({
          ...prev,
          loading: false,
          hotel: {
            _id:            data.hotel._id,
            name:           data.hotel.name,
            currencySymbol: data.hotel.currencySymbol ?? '₹',
            businessType:   data.hotel.businessType ?? 'both',
          },
          features:         data.hotel.features,
          categories:       data.categories,
          products:         data.products,
          bestsellerIds:    data.bestsellerIds,
          activeCategoryId: data.categories[0]?._id ?? null,
        }));
      })
      .catch((err: unknown) => {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load menu',
        }));
      });
  }, [hotelId]);

  const setActiveCategoryId = (id: string) =>
    setState((prev) => ({ ...prev, activeCategoryId: id }));

  return (
    <MenuContext.Provider value={{ ...state, setActiveCategoryId }}>
      {children}
    </MenuContext.Provider>
  );
}

export function useMenu(): MenuState {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('useMenu must be used inside <MenuProvider>');
  return ctx;
}
