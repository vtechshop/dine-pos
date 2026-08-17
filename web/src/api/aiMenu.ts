import { apiFetch } from './client';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExtractedVariant {
  name:  string;
  price: number;
}

export interface ExtractedModifierOption {
  name:  string;
  price: number;
}

export interface ExtractedModifierGroup {
  name:          string;
  required:      boolean;
  selectionType: 'single' | 'multi';
  options:       ExtractedModifierOption[];
}

export interface ExtractedProduct {
  name:           string;
  price:          number | null;
  variants:       ExtractedVariant[];
  modifierGroups: ExtractedModifierGroup[];
  veg:            boolean;
  gst:            number | null;
  hsnCode:        string;
  shortCode:      string;
  description:    string;
  confidence:     number;
}

export interface ExtractedCategory {
  name:     string;
  products: ExtractedProduct[];
}

export interface MenuExtractionResult {
  restaurantName: string;
  categories:     ExtractedCategory[];
}

export interface ImportVariant {
  name:  string;
  price: number;
}

export interface ImportModifierOption {
  name:  string;
  price: number;
}

export interface ImportModifierGroup {
  name:          string;
  required:      boolean;
  selectionType: 'single' | 'multi';
  options:       ImportModifierOption[];
}

export interface ImportProduct {
  name:            string;
  price:           number | null;
  variants:        ImportVariant[];
  modifierGroups:  ImportModifierGroup[];
  veg:             boolean;
  gst:             number | null;
  hsnCode:         string;
  shortCode:       string;
  description:     string;
  confidence:      number;
  duplicateAction?: 'skip' | 'overwrite' | 'copy';
}

export interface ImportCategory {
  name:     string;
  products: ImportProduct[];
}

export interface ImportResults {
  categoriesCreated:     number;
  productsCreated:       number;
  productsOverwritten:   number;
  productsSkipped:       number;
  modifierGroupsCreated: number;
  errors:                Array<{ name: string; reason: string }>;
}

export interface DuplicateCheckResult {
  duplicates: Array<{
    productName:          string;
    categoryName:         string;
    existingCategoryName: string;
  }>;
}

// ── API calls ──────────────────────────────────────────────────────────────────

// File upload uses native fetch — apiFetch sets Content-Type: application/json
// which must not override the multipart/form-data boundary set by the browser.
export async function extractMenu(file: File): Promise<MenuExtractionResult> {
  const token = localStorage.getItem('pos_token');
  const form  = new FormData();
  form.append('menu', file);

  const res = await fetch(`${API_BASE}/ai-menu/extract`, {
    method:  'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body:    form,
    signal:  AbortSignal.timeout(180_000), // 3 min — large PDFs via File API can take longer
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<MenuExtractionResult>;
}

export function checkDuplicates(
  categories: ExtractedCategory[],
): Promise<DuplicateCheckResult> {
  return apiFetch('/ai-menu/check-duplicates', {
    method: 'POST',
    body:   JSON.stringify({ categories }),
  });
}

export function importMenu(
  categories: ImportCategory[],
): Promise<{ success: boolean; results: ImportResults }> {
  return apiFetch('/ai-menu/import', {
    method: 'POST',
    body:   JSON.stringify({ categories }),
  });
}
