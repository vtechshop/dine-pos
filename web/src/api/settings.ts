import { apiFetch } from './client';
import type { Settings } from '../types';

export async function fetchSettings(): Promise<Settings> {
  const res = await apiFetch<{ settings: Settings } | Settings>('/settings');
  if (res && 'settings' in res && res.settings) return res.settings;
  return res as Settings;
}

export async function updateSettings(
  data: Partial<Settings> & { kitchenPin?: string },
): Promise<Settings> {
  const res = await apiFetch<{ settings: Settings } | Settings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (res && 'settings' in res && res.settings) return res.settings;
  return res as Settings;
}

export interface SubscriptionInfo {
  subscriptionStatus: string;
  subscriptionType: 'trial' | 'starter' | 'professional' | 'enterprise';
  trialEndDate: string | null;
  subscriptionEndDate: string | null;
  daysRemaining: number;
  isExpired: boolean;
  hotelName: string;
}

export async function fetchSubscription(): Promise<SubscriptionInfo> {
  return apiFetch('/hotels/subscription');
}

export async function updateOrgLoyaltySetting(orgLoyalty: boolean): Promise<{ orgLoyalty: boolean }> {
  return apiFetch('/settings/org-loyalty', {
    method: 'PATCH',
    body: JSON.stringify({ orgLoyalty }),
  });
}

export async function updateBranchOrgLoyaltyEnabled(branchId: string, orgLoyaltyEnabled: boolean): Promise<{ orgLoyaltyEnabled: boolean }> {
  return apiFetch(`/branches/${branchId}/org-loyalty-enabled`, {
    method: 'PATCH',
    body: JSON.stringify({ orgLoyaltyEnabled }),
  });
}
