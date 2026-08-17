import { apiFetch } from './client';

export interface AlertItem {
  type:      string;
  severity:  'critical' | 'warning' | 'info';
  title:     string;
  message:   string;
  value:     number;
  baseline:  number;
  changePct: number;
}

export interface AlertResult {
  date:       string;
  dataSource: 'realtime' | 'snapshot';
  checkedAt:  string;
  alerts:     AlertItem[];
}

export interface MenuItemScore {
  productId:      string;
  productName:    string;
  qty:            number;
  revenue:        number;
  revenuePerUnit: number;
  quadrant:       'star' | 'plow_horse' | 'puzzle' | 'dog';
}

export interface UpsellTarget {
  productName:    string;
  revenuePerUnit: number;
  currentOrders:  number;
  reason:         string;
}

export interface CrossSell {
  triggerItem: string;
  suggestItem: string;
  reason:      string;
}

export interface Combo {
  items:  string[];
  reason: string;
}

export interface SlowMover {
  productName: string;
  qty:         number;
  revenue:     number;
  suggestion:  string;
}

export interface RecommendationSet {
  date:            string;
  generatedAt:     string;
  insightSource:   'cache' | 'gemini' | 'unavailable';
  insight:         string | null;
  menuEngineering: MenuItemScore[];
  stars:           MenuItemScore[];
  plowHorses:      MenuItemScore[];
  puzzles:         MenuItemScore[];
  dogs:            MenuItemScore[];
  upsellTargets:   UpsellTarget[];
  crossSell:       CrossSell[];
  combos:          Combo[];
  slowMovers:      SlowMover[];
  highMarginItems: MenuItemScore[];
}

export interface AlertRecord {
  _id:        string;   // MongoDB ObjectId — used for PATCH /:id/read
  type:       string;
  severity:   'critical' | 'warning' | 'info';
  title:      string;
  message:    string;
  value:      number;
  baseline:   number;
  changePct:  number;
  dedupDate:  string;
  isRead:     boolean;
  readAt?:    string;
  resolvedAt?: string;
  createdAt:  string;   // Mongoose timestamps — when the alert was first persisted
  updatedAt:  string;
}

export function fetchAlerts(): Promise<AlertResult> {
  return apiFetch('/ai/alerts');
}

export function fetchAlertHistory(): Promise<{ alerts: AlertRecord[] }> {
  return apiFetch('/ai/alerts/history');
}

export function markAlertRead(alertId: string): Promise<{ success: boolean }> {
  return apiFetch(`/ai/alerts/${alertId}/read`, { method: 'PATCH' });
}

export function fetchAlertsByDate(date: string): Promise<AlertResult> {
  return apiFetch(`/ai/alerts/${date}`);
}

export function fetchRecommendations(): Promise<RecommendationSet> {
  return apiFetch('/ai/recommendations');
}

export function fetchRecommendationsByDate(date: string): Promise<RecommendationSet> {
  return apiFetch(`/ai/recommendations/${date}`);
}
