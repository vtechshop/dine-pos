import { apiFetch } from './client';

export interface SearchResults {
  reservations: Array<{ _id: string; customerName: string; phone: string; date: string; time: string; partySize?: number; status: string; tableNumber?: number | null }>;
  orders:       Array<{ _id: string; orderNumber: string; customerName?: string; tableNumber?: string; grandTotal?: number; status: string; createdAt: string }>;
  customers:    Array<{ _id: string; name: string; phone?: string | null; lastVisitAt?: string | null }>;
  tables:       Array<{ _id: string; number: number; name?: string; status: string }>;
}

export function globalSearch(q: string): Promise<SearchResults> {
  return apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`);
}
