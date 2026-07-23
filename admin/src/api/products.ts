import { apiFetch } from './client';

export interface Category {
  _id:      string;
  name:     string;
  hotelId:  string;
  sortOrder: number;
}

export interface Product {
  _id:         string;
  name:        string;
  price:       number;
  category:    string | Category;
  description: string;
  isAvailable: boolean;
  isVeg:       boolean;
  imageUrl:    string;
  hotelId:     string;
  createdAt:   string;
  updatedAt:   string;
}

export const fetchProducts = (params?: { category?: string; search?: string }) => {
  const q = new URLSearchParams();
  if (params?.category) q.set('category', params.category);
  if (params?.search)   q.set('search',   params.search);
  return apiFetch<Product[]>(`/products?${q}`);
};

export const fetchCategories = () =>
  apiFetch<Category[]>('/categories');

// ── Menu Channel Management — NOT YET IMPLEMENTED IN BACKEND ─────────────────
// Required endpoints:
//   GET  /products/:id/channels           — channel-specific pricing & availability
//   PUT  /products/:id/channels/:channel  — set channel-specific price/availability
//   POST /products/channels/bulk-sync     — sync channel prices in bulk
//
// Channels: pos | website | qr | swiggy | zomato
