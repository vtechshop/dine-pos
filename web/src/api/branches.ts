import { apiFetch } from './client';

const BASE = '/branches';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Branch {
  _id:            string;
  hotelName:      string;
  branchName:     string;
  branchCode:     string;
  parentHotelId:  string;
  isHeadquarters: boolean;
  maxBranches:    number;
  status:         'active' | 'suspended' | 'expired' | 'pending' | 'trial' | 'rejected';
  adminId:        string;
  phone:          string;
  address:        string;
  city:           string;
  state:          string;
  pincode:        string;
  gstNumber:      string;
  timezone:       string;
  features:       Record<string, boolean | string>;
  createdAt:      string;
  updatedAt:      string;
}

export interface BranchListResponse {
  branches: Branch[];
  total:    number;
}

export interface BranchCountResponse {
  count:              number;
  maxBranches:        number;
  isHeadquarters:     boolean;
  multiBranchEnabled: boolean;
}

export interface BranchContext {
  orgHotelId:         string;
  orgHotelName:       string;
  isHeadquarters:     boolean;
  currentBranchId:    string | null;
  multiBranchEnabled: boolean;
  branches:           Pick<Branch, '_id' | 'hotelName' | 'branchName' | 'branchCode' | 'status' | 'isHeadquarters' | 'createdAt'>[];
}

export interface SwitchBranchResponse {
  branchToken:        string;
  branchRefreshToken: string;
  branchId:           string;
  branchName:         string;
  branchCode:         string;
  orgHotelId:         string;
  orgHotelName:       string;
}

export interface CreateBranchPayload {
  branchName:    string;
  adminId:       string;
  adminPassword: string;
  branchCode?:   string;
  address?:      string;
  phone?:        string;
  city?:         string;
  state?:        string;
  pincode?:      string;
  gstNumber?:    string;
  timezone?:     string;
}

export interface UpdateBranchPayload {
  branchName?: string;
  address?:    string;
  phone?:      string;
  city?:       string;
  state?:      string;
  pincode?:    string;
  gstNumber?:  string;
  timezone?:   string;
}

// ── API functions ─────────────────────────────────────────────────────────────

export const fetchBranches = (): Promise<BranchListResponse> =>
  apiFetch<BranchListResponse>(`${BASE}/`);

export const fetchBranchCount = (): Promise<BranchCountResponse> =>
  apiFetch<BranchCountResponse>(`${BASE}/count`);

export const getBranchContext = (): Promise<BranchContext> =>
  apiFetch<BranchContext>(`${BASE}/context`);

export const switchBranch = (branchId: string): Promise<SwitchBranchResponse> =>
  apiFetch<SwitchBranchResponse>(`${BASE}/switch`, {
    method: 'POST',
    body: JSON.stringify({ branchId }),
  });

export const fetchBranch = (branchId: string): Promise<{ branch: Branch }> =>
  apiFetch<{ branch: Branch }>(`${BASE}/${branchId}`);

export const createBranch = (payload: CreateBranchPayload): Promise<{ branch: Branch; message: string }> =>
  apiFetch<{ branch: Branch; message: string }>(`${BASE}/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateBranch = (branchId: string, payload: UpdateBranchPayload): Promise<{ branch: Branch }> =>
  apiFetch<{ branch: Branch }>(`${BASE}/${branchId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deactivateBranch = (branchId: string): Promise<{ message: string }> =>
  apiFetch<{ message: string }>(`${BASE}/${branchId}/deactivate`, { method: 'POST' });

export const reactivateBranch = (branchId: string): Promise<{ message: string }> =>
  apiFetch<{ message: string }>(`${BASE}/${branchId}/reactivate`, { method: 'POST' });
