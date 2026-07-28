import { apiFetch } from './client';

export interface Anomaly {
  type:       string;
  label:      string;
  severity:   'low' | 'medium' | 'high';
  confidence: number;
  evidence:   string;
  metric:     Record<string, number>;
}

export interface AnomalyReport {
  hotelId:        string;
  analysisDate:   string;
  dataWindowDays: number;
  allClear:       boolean;
  anomalies:      Anomaly[];
  summary:        string;
  generatedAt:    string;
}

export interface StaffHotelAvg {
  ordersPerStaff:  number;
  revenuePerStaff: number;
  aov:             number;
  cancelRate:      number;
  discountPct:     number;
}

export interface StaffMemberStats {
  cashierId:        string;
  totalOrders:      number;
  completedOrders:  number;
  cancelledOrders:  number;
  cancelRate:       number;
  totalRevenue:     number;
  avgOrderValue:    number;
  totalDiscount:    number;
  avgDiscountPct:   number;
  revenueShare:     number;
  performanceScore: number;
  rank:             number;
}

export interface StaffAnalyticsReport {
  hotelId:      string;
  windowDays:   number;
  generatedAt:  string;
  hotelAvg:     StaffHotelAvg;
  staff:        StaffMemberStats[];
  totalRevenue: number;
  totalOrders:  number;
  activeStaff:  number;
  topPerformer: string | null;
  summary:      string;
}

export interface HourlyKitchenStats {
  hour:                number;
  orderCount:          number;
  avgFulfillmentMin:   number;
  minFulfillmentMin:   number;
  maxFulfillmentMin:   number;
  p90FulfillmentMin:   number;
}

export interface ItemThroughputStats {
  productName: string;
  orderCount:  number;
  share:       number;
}

export interface KitchenAnalyticsReport {
  hotelId:               string;
  windowDays:            number;
  generatedAt:           string;
  totalOrdersAnalyzed:   number;
  avgFulfillmentMin:     number;
  medianFulfillmentMin:  number;
  p90FulfillmentMin:     number;
  fastestHour:           number | null;
  slowestHour:           number | null;
  peakLoadHour:          number | null;
  hourly:                HourlyKitchenStats[];
  topItems:              ItemThroughputStats[];
  slaBreachPct:          number;
  slaDurationMin:        number;
  summary:               string;
}

export function fetchAnomalies(): Promise<AnomalyReport> {
  return apiFetch('/ai/analytics/anomalies');
}

export function fetchStaffAnalytics(): Promise<StaffAnalyticsReport> {
  return apiFetch('/ai/analytics/staff');
}

export function fetchKitchenAnalytics(): Promise<KitchenAnalyticsReport> {
  return apiFetch('/ai/analytics/kitchen');
}
