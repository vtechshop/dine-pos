import { apiFetch } from './client';

export interface BranchCategoryVisibility {
  branchHotelId: string;
  branchName: string;
  branchCode: string;
  enabled: boolean;
  configured: boolean;
}

export interface CategoryWithVisibility {
  _id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  branchVisibility: BranchCategoryVisibility[];
}

export interface CategoryBranchConfig {
  enabled: boolean;
  displayOrder: number | null;
  configured: boolean;
}

export async function getOrgCategoryMatrix(): Promise<{
  orgHotelId: string;
  categories: CategoryWithVisibility[];
  branches: Array<{ _id: string; hotelName: string; branchCode: string; branchName: string }>;
}> {
  return apiFetch('/api/category-config/org');
}

export async function getBranchCategoryConfigs(branchId: string): Promise<{
  orgHotelId: string;
  branchId: string;
  branchName: string;
  categories: Array<{ _id: string; name: string; branchConfig: CategoryBranchConfig }>;
}> {
  return apiFetch(`/api/category-config/branches/${branchId}`);
}

export async function setCategoryVisibility(
  branchId: string,
  categoryId: string,
  enabled: boolean,
  displayOrder?: number,
): Promise<{ config: any }> {
  return apiFetch(`/api/category-config/branches/${branchId}/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled, ...(displayOrder !== undefined ? { displayOrder } : {}) }),
  });
}

export async function resetCategoryConfig(branchId: string, categoryId: string): Promise<{ message: string }> {
  return apiFetch(`/api/category-config/branches/${branchId}/categories/${categoryId}`, {
    method: 'DELETE',
  });
}
