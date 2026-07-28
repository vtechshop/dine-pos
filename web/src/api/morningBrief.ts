import { apiFetch } from './client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BusinessSummary {
  revenue:                  number;
  orders:                   number;
  estimatedProfit:          number;
  estimatedProfitMarginPct: number;
  avgBill:                  number;
  healthScore:              number;
  healthGrade:              'A' | 'B' | 'C' | 'D' | 'F';
  topSellingItem:           string | null;
  topSellingItemRevenue:    number;
  topSellingItemQty:        number;
  peakHour:                 number;
  topPaymentMethod:         string;
  revenueVs7DayAvgPct:     number | null;
  ordersVs7DayAvgPct:      number | null;
  cancelledOrders:          number;
  cancelRate:               number;
}

export interface MorningBriefMenuItem {
  name:    string;
  revenue: number;
  qty:     number;
}

export interface MenuSummary {
  topMenuItems: MorningBriefMenuItem[];
  slowMovers:   string[];
}

export interface InventorySummary {
  criticalItems:        string[];
  warningItems:         string[];
  overstockItems:       string[];
  reorderRequiredNames: string[];
  totalReorderCost:     number;
  criticalCount:        number;
  warningCount:         number;
}

export interface ForecastSummary {
  expectedRevenue:    number;
  expectedOrders:     number;
  expectedAov:        number;
  topBusyHours:       number[];
  forecastConfidence: number;
  method:             string;
}

export interface MorningBrief {
  _id:             string;
  date:            string;
  generatedAt:     string;
  business:        BusinessSummary;
  menu:            MenuSummary;
  inventory:       InventorySummary;
  forecast:        ForecastSummary;
  executiveSummary: string;
  recommendations:  string[];
  opportunity:      string;
  warning:          string | null;
}

export interface BriefHistoryItem {
  _id:             string;
  date:            string;
  generatedAt:     string;
  business: Pick<BusinessSummary, 'revenue' | 'orders' | 'healthScore' | 'healthGrade' | 'topSellingItem'>;
  executiveSummary: string;
  warning:          string | null;
}

export interface BriefHistoryResponse {
  briefs: BriefHistoryItem[];
  total:  number;
  limit:  number;
  skip:   number;
}

// ── API calls ──────────────────────────────────────────────────────────────────

export function fetchLatestBrief(): Promise<MorningBrief> {
  return apiFetch('/ai/morning-brief');
}

export function fetchBriefByDate(date: string): Promise<MorningBrief> {
  return apiFetch(`/ai/morning-brief/${date}`);
}

export function fetchBriefHistory(limit = 30, skip = 0): Promise<BriefHistoryResponse> {
  return apiFetch(`/ai/morning-brief-history?limit=${limit}&skip=${skip}`);
}
