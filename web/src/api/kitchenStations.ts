import { apiFetch } from './client';
import type { KitchenStation } from '../types';

export type { KitchenStation };

export async function fetchKitchenStations(): Promise<KitchenStation[]> {
  return apiFetch<KitchenStation[]>('/kitchen-stations');
}

export async function createKitchenStation(data: { name: string; sortOrder?: number }): Promise<KitchenStation> {
  return apiFetch<KitchenStation>('/kitchen-stations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateKitchenStation(
  id: string,
  data: Partial<{ name: string; isActive: boolean; sortOrder: number }>,
): Promise<KitchenStation> {
  return apiFetch<KitchenStation>(`/kitchen-stations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteKitchenStation(id: string): Promise<void> {
  await apiFetch<unknown>(`/kitchen-stations/${id}`, { method: 'DELETE' });
}
