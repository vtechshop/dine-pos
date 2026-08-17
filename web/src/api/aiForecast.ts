import { apiFetch } from './client';

export interface ForecastPoint {
  date:           string;
  value:          number;
  confidenceLow?: number;   // MAPE-based lower bound — may be absent on older data
  confidenceHigh?: number;  // MAPE-based upper bound
}

export interface ForecastMeta {
  method:     string;
  confidence: number;
  mape:       number;
}

export interface PeakHourPoint {
  hour:          number;
  avgRevShare:   number;
  avgOrderShare: number;
}

export interface ItemDemandForecast {
  productId:   string;
  productName: string;
  forecastQty: number;
  avgQty7d:    number;
  trend:       'rising' | 'falling' | 'stable';
}

export interface SalesForecast {
  generatedAt:          string;
  dataPoints:           number;
  revenueNext7d:        ForecastPoint[];
  revenueNext30d:       ForecastPoint[];
  revenueForecastMeta:  ForecastMeta;
  ordersNext7d:         ForecastPoint[];
  ordersNext30d:        ForecastPoint[];
  ordersForecastMeta:   ForecastMeta;
  forecastWeekRevenue:  number;
  forecastWeekOrders:   number;
  avgForecastAOV:       number;
  peakHourDistribution: PeakHourPoint[];
  topPeakHours:         number[];
  itemDemand:           ItemDemandForecast[];
  tableUtilNext7d:      ForecastPoint[];
  revenueAccuracy?: {
    mape:       number;
    dataPoints: number;
    grade:      'good' | 'fair' | 'poor';
  };
  narrative:            string | null;
  narrativeSource:      'cache' | 'gemini' | 'unavailable';
}

export interface IngredientPrediction {
  ingredientId:        string;
  name:                string;
  unit:                string;
  currentStock:        number;
  lowStockThreshold:   number;
  costPerUnit:         number;
  estimatedDailyUsage: number;
  daysRemaining:       number;
  status:              'critical' | 'warning' | 'ok' | 'overstock';
  reorderQty:          number;
  reorderCost:         number;
  usageSource:         'grn' | 'heuristic';
}

export interface InventoryCoverage {
  criticalCount:  number;
  warningCount:   number;
  okCount:        number;
  overstockCount: number;
}

export interface InventoryForecast {
  generatedAt:      string;
  totalIngredients: number;
  totalReorderCost: number;
  coverageSummary:  InventoryCoverage;
  criticalItems:    IngredientPrediction[];
  warningItems:     IngredientPrediction[];
  healthyItems:     IngredientPrediction[];
  overstockItems:   IngredientPrediction[];
  topReorderItems:  IngredientPrediction[];
}

export function fetchSalesForecast(): Promise<SalesForecast> {
  return apiFetch('/ai/forecast');
}

export function fetchInventoryForecast(): Promise<InventoryForecast> {
  return apiFetch('/ai/forecast/inventory');
}

// ── Purchase suggestions ──────────────────────────────────────────────────────

export interface PurchaseSuggestion {
  itemName:       string;
  currentStock:   number;
  unit:           string;
  urgency:        'critical' | 'soon' | 'plan';
  suggestedQty:   number;
  estimatedCost?: number;
  hasPendingPO:   boolean;
  reason:         string;
}

export interface PurchaseSuggestionResult {
  suggestions:        PurchaseSuggestion[];
  totalEstimatedCost: number;
  limitations:        string[];
  generatedAt:        string;
}

export function fetchPurchaseSuggestions(): Promise<PurchaseSuggestionResult> {
  return apiFetch('/ai/forecast/purchase');
}
