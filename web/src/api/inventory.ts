import { apiFetch } from './client';
import type { Ingredient, StockMovement, InventorySummary } from '../types';

// ── All ingredients ────────────────────────────────────────────────────────────
export async function fetchIngredients(): Promise<Ingredient[]> {
  return apiFetch<Ingredient[]>('/ingredients');
}

// ── Summary (KPI cards) ──────────────────────────────────────────────────────
export async function fetchInventorySummary(): Promise<InventorySummary> {
  return apiFetch('/ingredients/summary');
}

// ── Stock In ─────────────────────────────────────────────────────────────────
export interface StockInInput {
  quantity: number;
  costPerUnit: number;
  supplier?: string;
  invoiceNumber?: string;
  date?: string;
  notes?: string;
}

export interface StockInResponse {
  ingredient: Ingredient;
  movement: {
    delta: number;
    previousStock: number;
    resultingStock: number;
    costPerUnit: number;
    totalCost: number;
  };
}

export async function stockInIngredient(id: string, data: StockInInput): Promise<StockInResponse> {
  return apiFetch<StockInResponse>(`/ingredients/${id}/stock-in`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Stock Adjustment ──────────────────────────────────────────────────────────
export interface AdjustInput {
  physicalStock: number;
  reason?: string;
  notes?: string;
}

export interface AdjustResponse {
  ingredient: Ingredient;
  movement: {
    delta: number;
    previousStock: number;
    resultingStock: number;
    reason: string;
  };
  message?: string;
}

export async function adjustIngredient(id: string, data: AdjustInput): Promise<AdjustResponse> {
  return apiFetch<AdjustResponse>(`/ingredients/${id}/adjust`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Stock History ─────────────────────────────────────────────────────────────
export async function fetchIngredientHistory(
  id: string,
  params?: { limit?: number; skip?: number },
): Promise<{ movements: StockMovement[]; total: number; limit: number; skip: number }> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.skip  != null) qs.set('skip',  String(params.skip));
  const q = qs.toString();
  return apiFetch(`/ingredients/${id}/history${q ? `?${q}` : ''}`);
}
