import { apiFetch } from './client';
import type { ModifierGroup } from '../types';

export interface ModifierGroupInput {
  name: string;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
  isRequired?: boolean;
  selectionType?: 'single' | 'multi';
  minSelections?: number;
  maxSelections?: number;
  options?: Array<{
    name: string;
    price?: number;
    sku?: string;
    barcode?: string;
    isActive?: boolean;
    displayOrder?: number;
  }>;
}

export interface ModifierOptionInput {
  name: string;
  price?: number;
  sku?: string;
  barcode?: string;
  isActive?: boolean;
  displayOrder?: number;
}

export interface ModifierGroupsResponse {
  groups: ModifierGroup[];
  total: number;
  limit: number;
  skip: number;
}

export async function fetchModifierGroups(params?: {
  search?: string;
  active?: boolean;
  limit?: number;
  skip?: number;
}): Promise<ModifierGroupsResponse> {
  const qs = new URLSearchParams();
  if (params?.search)  qs.set('search', params.search);
  if (params?.active === true)  qs.set('active', 'true');
  if (params?.active === false) qs.set('active', 'false');
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.skip  != null) qs.set('skip',  String(params.skip));
  const q = qs.toString();
  return apiFetch<ModifierGroupsResponse>(`/modifiers${q ? `?${q}` : ''}`);
}

export async function fetchModifierGroup(id: string): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>(`/modifiers/${id}`);
}

export async function createModifierGroup(data: ModifierGroupInput): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>('/modifiers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModifierGroup(id: string, data: Partial<ModifierGroupInput>): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>(`/modifiers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteModifierGroup(id: string): Promise<void> {
  await apiFetch<{ message: string }>(`/modifiers/${id}`, { method: 'DELETE' });
}

export async function addModifierOption(groupId: string, data: ModifierOptionInput): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>(`/modifiers/${groupId}/options`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModifierOption(
  groupId: string,
  optionId: string,
  data: Partial<ModifierOptionInput>,
): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>(`/modifiers/${groupId}/options/${optionId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteModifierOption(groupId: string, optionId: string): Promise<ModifierGroup> {
  return apiFetch<ModifierGroup>(`/modifiers/${groupId}/options/${optionId}`, {
    method: 'DELETE',
  });
}

export async function assignModifierGroupToProduct(productId: string, modifierGroupId: string): Promise<void> {
  await apiFetch<unknown>(`/products/${productId}/modifier-groups`, {
    method: 'POST',
    body: JSON.stringify({ modifierGroupId }),
  });
}

export async function removeModifierGroupFromProduct(productId: string, modifierGroupId: string): Promise<void> {
  await apiFetch<unknown>(`/products/${productId}/modifier-groups/${modifierGroupId}`, {
    method: 'DELETE',
  });
}
