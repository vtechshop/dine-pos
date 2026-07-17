import { apiFetch } from './client';
import type { Settings } from '../types';

export async function fetchSettings(): Promise<Settings> {
  const res = await apiFetch<{ settings: Settings } | Settings>('/settings');
  if (res && 'settings' in res && res.settings) return res.settings;
  return res as Settings;
}
