import { apiFetch } from './client';

export interface HealthScore {
  score: number;
  grade: string;
}

export interface DailyReportSnapshot {
  totalRevenue:            number;
  totalOrders:             number;
  avgOrderValue:           number;
  cancelledOrders:         number;
  cancelledRevenue:        number;
  paymentBreakdown:        { cash: number; upi: number; card: number; split: number };
  sourceBreakdown:         { dineIn: number; takeaway: number; qr: number; swiggy: number; zomato: number; other: number };
  topItems:                Array<{ productName: string; qty: number; revenue: number }>;
  peakHour:                number;
  peakHourRevenue:         number;
  hourlyRevenue:           number[];
  hourlyOrders:            number[];
  uniqueTables:            number;
  revenueVs7DayAvgPct:     number | null;
  ordersVs7DayAvgPct:      number | null;
  revenueVsSameWeekdayPct: number | null;
}

export interface DailyReportPayload {
  date:            string;
  hotelId:         string;
  snapshot:        DailyReportSnapshot;
  health:          HealthScore;
  narrative:       string | null;
  narrativeSource: 'cache' | 'gemini' | 'unavailable';
  generatedAt:     string;
}

export interface DashboardTrend {
  date:         string;
  totalRevenue: number;
  totalOrders:  number;
  healthScore:  number;
}

export interface WeekComparison {
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  changePct:       number | null;
}

export interface ExecutiveDashboard {
  today: {
    revenue:   number;
    orders:    number;
    updatedAt: string;
    topItems:  Array<{ productId: string; productName: string; revenue: number }>;
    source:    'cache' | 'mongodb';
  };
  trend:             DashboardTrend[];
  weekComparison:    WeekComparison;
  latestHealthScore: { date: string; score: number; grade: string } | null;
}

export interface TodayMetrics {
  source:    'cache' | 'mongodb';
  revenue:   number;
  orders:    number;
  updatedAt: string;
  topItems:  Array<{ name: string; qty: number }>;
}

export function fetchExecutiveDashboard(): Promise<ExecutiveDashboard> {
  return apiFetch('/ai/dashboard');
}

export function fetchAIReport(date: string): Promise<DailyReportPayload> {
  return apiFetch(`/ai/report/${date}`);
}

export function fetchTodayMetrics(): Promise<TodayMetrics> {
  return apiFetch('/ai/metrics/today');
}
