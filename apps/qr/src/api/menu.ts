import type { Category, Product, FeatureFlags } from '@dinepos/shared/types';
import { publicFetch } from './client.ts';

export interface MenuResponse {
  hotel: {
    _id:      string;
    name:     string;
    features: FeatureFlags;
    currencySymbol?: string;
    businessType?:   'veg' | 'non-veg' | 'both';
  };
  categories:   Category[];
  products:     Product[];
  bestsellerIds: string[];
  cachedAt:     string;
}

export function fetchMenu(hotelId: string): Promise<MenuResponse> {
  return publicFetch<MenuResponse>(`/public/menu?hotel=${encodeURIComponent(hotelId)}`);
}
