import { apiFetch } from './client';
import type { Product, Category, Ingredient } from '../types';

// ── Products ──────────────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  price: number;
  category: string;
  taxPercent?: number;
  hsnCode?: string;
  isAvailable?: boolean;
  isVeg?: boolean;
  shortCode?: string;
  description?: string;
  stock?: number;
}

export async function fetchProducts(params?: {
  search?: string;
  category?: string;
  available?: boolean;
}): Promise<Product[]> {
  const qs = new URLSearchParams();
  if (params?.search)             qs.set('search', params.search);
  if (params?.category)           qs.set('category', params.category);
  if (params?.available === true)  qs.set('available', 'true');
  const q = qs.toString();
  return apiFetch<Product[]>(`/products${q ? `?${q}` : ''}`);
}

export async function createProduct(data: ProductInput): Promise<Product> {
  return apiFetch<Product>('/products', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProduct(id: string, data: Partial<ProductInput>): Promise<Product> {
  return apiFetch<Product>(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await apiFetch<{ message: string }>(`/products/${id}`, { method: 'DELETE' });
}

export async function fetchLowStockProducts(
  threshold = 5,
): Promise<{ products: Product[]; threshold: number }> {
  return apiFetch(`/products/alerts/low-stock?threshold=${threshold}`);
}

// ── Categories ────────────────────────────────────────────────────────────────

export interface CategoryInput {
  name: string;
  icon?: string;
  color?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export async function createCategory(data: CategoryInput): Promise<Category> {
  return apiFetch<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCategory(id: string, data: Partial<CategoryInput>): Promise<Category> {
  return apiFetch<Category>(`/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch<{ message: string }>(`/categories/${id}`, { method: 'DELETE' });
}

// ── Ingredients ───────────────────────────────────────────────────────────────

export interface IngredientInput {
  name: string;
  unit: string;
  currentStock?: number;
  lowStockThreshold?: number;
  costPerUnit?: number;
}

export async function fetchIngredients(params?: {
  limit?: number;
  skip?: number;
}): Promise<{ ingredients: Ingredient[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.skip  != null) qs.set('skip',  String(params.skip));
  const q = qs.toString();
  return apiFetch(`/ingredients${q ? `?${q}` : ''}`);
}

export async function createIngredient(data: IngredientInput): Promise<Ingredient> {
  return apiFetch<Ingredient>('/ingredients', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateIngredient(
  id: string,
  data: Partial<IngredientInput>,
): Promise<Ingredient> {
  return apiFetch<Ingredient>(`/ingredients/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function restockIngredient(id: string, quantity: number): Promise<Ingredient> {
  return apiFetch<Ingredient>(`/ingredients/${id}/restock`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity }),
  });
}

export async function deleteIngredient(id: string): Promise<void> {
  await apiFetch<{ message: string }>(`/ingredients/${id}`, { method: 'DELETE' });
}

export async function fetchLowStockIngredients(): Promise<{ ingredients: Ingredient[] }> {
  return apiFetch('/ingredients/alerts/low-stock');
}
