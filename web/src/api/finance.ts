import { apiFetch } from './client';
import type { FinanceDashboard, MenuProfitabilityReport, CogsTrendPoint } from '../types/reports';

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function fetchFinanceDashboard(from?: string, to?: string): Promise<FinanceDashboard> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to)   params.to   = to;
  const q = qs(params);
  return apiFetch<FinanceDashboard>(`/finance/dashboard${q ? `?${q}` : ''}`);
}

export async function fetchMenuProfitability(params?: {
  from?: string;
  to?: string;
  sort?: 'margin' | 'revenue' | 'qty' | 'cogs' | 'grossProfit' | 'name';
  dir?: 'asc' | 'desc';
  limit?: number;
  skip?: number;
}): Promise<MenuProfitabilityReport> {
  const p: Record<string, string> = {};
  if (params?.from)  p.from  = params.from;
  if (params?.to)    p.to    = params.to;
  if (params?.sort)  p.sort  = params.sort;
  if (params?.dir)   p.dir   = params.dir;
  if (params?.limit !== undefined) p.limit = String(params.limit);
  if (params?.skip  !== undefined) p.skip  = String(params.skip);
  const q = qs(p);
  return apiFetch<MenuProfitabilityReport>(`/finance/menu-profitability${q ? `?${q}` : ''}`);
}

export async function fetchCogsTrend(from?: string, to?: string, groupBy?: 'day' | 'week' | 'month'): Promise<CogsTrendPoint[]> {
  const p: Record<string, string> = {};
  if (from)    p.from    = from;
  if (to)      p.to      = to;
  if (groupBy) p.groupBy = groupBy;
  const q = qs(p);
  return apiFetch<CogsTrendPoint[]>(`/finance/cogs-trend${q ? `?${q}` : ''}`);
}
