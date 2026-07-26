import { apiFetch } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WasteAnalysis {
  period:  { from: string; to: string; days: number };
  summary: { totalCost: number; itemCount: number; wastePct: number; avgDailyLoss: number };
  byReason: { reason: string; totalLoss: number; count: number }[];
  topItems: { productName: string; totalLoss: number; totalQty: number; count: number }[];
  trend:    { date: string; totalLoss: number; count: number }[];
}

export interface CostVarianceItem {
  ingredientId:    string;
  name:            string;
  unit:            string;
  currentCost:     number;
  avgPurchaseCost: number;
  lastPrice:       number;
  lastDate:        string;
  variance:        number;
  variancePct:     number;
  trend:           'increased' | 'decreased' | 'stable';
  purchaseCount:   number;
}
export interface CostVariance {
  items:   CostVarianceItem[];
  summary: { increased: number; decreased: number; stable: number };
}

export interface VendorPriceRow {
  ingredientId:   string;
  ingredientName: string;
  unit:           string;
  currentWAC:     number;
  overallMin:     number;
  overallMax:     number;
  vendors: {
    vendorId:      string;
    vendorName:    string;
    vendorCode:    string;
    minPrice:      number;
    maxPrice:      number;
    avgPrice:      number;
    lastPrice:     number;
    purchaseCount: number;
    totalQty:      number;
    totalValue:    number;
  }[];
}

export interface InventoryValue {
  summary: {
    totalIngredients:  number;
    currentStockValue: number;
    lowStockCount:     number;
    lowStockValue:     number;
    outOfStockCount:   number;
    outOfStockValue:   number;
  };
  topByValue:      { _id: string; name: string; unit: string; currentStock: number; costPerUnit: number; value: number; lowStockThreshold: number }[];
  lowStockItems:   { _id: string; name: string; unit: string; currentStock: number; lowStockThreshold: number; costPerUnit: number; value: number }[];
  outOfStockItems: { _id: string; name: string; unit: string; costPerUnit: number; value: number }[];
}

export interface StockMovementItem {
  ingredientId:        string;
  name:                string;
  unit:                string;
  currentStock:        number;
  costPerUnit:         number;
  value:               number;
  totalConsumed:       number;
  avgDailyConsumption: number;
  orderCount:          number;
}
export interface StockMovement {
  period:  { from: string; to: string; days: number };
  summary: { fastMovingCount: number; slowMovingCount: number; deadStockCount: number; deadStockValue: number };
  fastMoving: StockMovementItem[];
  slowMoving: StockMovementItem[];
  deadStock:  StockMovementItem[];
}

export interface StockTurnover {
  period:         { from: string; to: string; days: number };
  cogs:           number;
  inventoryValue: number;
  annualCOGS:     number;
  turnoverRatio:  number;
  daysOfInventory: number;
  avgDailyCOGS:   number;
}

export interface PurchaseIntelligence {
  period:  { from: string; to: string };
  summary: { totalGRNs: number; totalSpend: number; uniqueVendors: number; uniqueIngredients: number };
  topIngredients:     { _id: string; name: string; unit: string; totalQty: number; totalValue: number; grnCount: number; avgPrice: number }[];
  vendorContribution: { _id: string; vendorName: string; vendorCode: string; totalSpend: number; grnCount: number; pct: number }[];
  monthlySpend:       { _id: string; totalSpend: number; grnCount: number }[];
}

// ── API calls ─────────────────────────────────────────────────────────────────

const base = '/api/inventory-intelligence';

export function fetchWasteAnalysis(from?: string, to?: string): Promise<WasteAnalysis> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<WasteAnalysis>(`${base}/waste-analysis?${p}`);
}

export function fetchCostVariance(): Promise<CostVariance> {
  return apiFetch<CostVariance>(`${base}/cost-variance`);
}

export function fetchVendorPriceComparison(from?: string, to?: string): Promise<VendorPriceRow[]> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<VendorPriceRow[]>(`${base}/vendor-price-comparison?${p}`);
}

export function fetchInventoryValue(): Promise<InventoryValue> {
  return apiFetch<InventoryValue>(`${base}/inventory-value`);
}

export function fetchStockMovement(from?: string, to?: string): Promise<StockMovement> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<StockMovement>(`${base}/stock-movement?${p}`);
}

export function fetchStockTurnover(from?: string, to?: string): Promise<StockTurnover> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<StockTurnover>(`${base}/stock-turnover?${p}`);
}

export function fetchPurchaseIntelligence(from?: string, to?: string): Promise<PurchaseIntelligence> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<PurchaseIntelligence>(`${base}/purchase-intelligence?${p}`);
}
