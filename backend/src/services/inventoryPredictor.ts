// ─── Inventory Prediction Engine ─────────────────────────────────────────────
// Predicts stock-out risk, overstock, and reorder quantities.
// Uses GRN receipts as a proxy for daily consumption (stable-system assumption).
// All arithmetic is Node.js only. Gemini is never called from this service.

import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient';
import GRN from '../models/GRN';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockStatus = 'critical' | 'warning' | 'ok' | 'overstock';

export interface IngredientPrediction {
  ingredientId:        string;
  name:                string;
  unit:                string;
  currentStock:        number;
  lowStockThreshold:   number;
  costPerUnit:         number;
  estimatedDailyUsage: number;   // derived from GRN inflow or threshold heuristic
  daysRemaining:       number;   // currentStock / estimatedDailyUsage
  status:              StockStatus;
  reorderQty:          number;   // units needed to reach 14-day safety stock
  reorderCost:         number;   // reorderQty × costPerUnit
  usageSource:         'grn' | 'heuristic';  // how daily usage was estimated
}

export interface InventoryForecast {
  generatedAt:          string;
  totalIngredients:     number;
  criticalItems:        IngredientPrediction[];   // < 3 days remaining
  warningItems:         IngredientPrediction[];   // 3–7 days remaining
  overstockItems:       IngredientPrediction[];   // > 30 days remaining
  healthyItems:         IngredientPrediction[];   // 7–30 days remaining
  totalReorderCost:     number;                   // sum of all critical + warning reorder costs
  topReorderItems:      IngredientPrediction[];   // top 10 by reorderCost, critical/warning only
  coverageSummary: {
    criticalCount:  number;
    warningCount:   number;
    okCount:        number;
    overstockCount: number;
  };
}

// ─── GRN-based daily usage estimation ────────────────────────────────────────
// Strategy: total received qty over last 60 days / 60 ≈ avg daily consumption.
// This works in a stable-inventory system where inflows ≈ consumption.

async function buildGRNUsageMap(
  hotelOId: mongoose.Types.ObjectId,
): Promise<Map<string, number>> {
  const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const grns = await GRN.find(
    {
      hotelId:    hotelOId,
      isDeleted:  false,
      status:     { $in: ['partial', 'completed'] },
      receiveDate: { $gte: since60d },
    },
    { receiveDate: 1, items: 1 },
  ).lean();

  // Sum receivedQty per ingredientId across all GRNs
  const totals = new Map<string, { totalQty: number; earliestDate: Date }>();

  for (const grn of grns) {
    for (const item of grn.items) {
      if (!item.ingredientId) continue;
      const id  = item.ingredientId.toString();
      const qty = item.receivedQty - (item.damagedQty ?? 0) - (item.rejectedQty ?? 0);
      if (qty <= 0) continue;

      const existing = totals.get(id);
      if (!existing) {
        totals.set(id, { totalQty: qty, earliestDate: grn.receiveDate });
      } else {
        existing.totalQty += qty;
        if (grn.receiveDate < existing.earliestDate) {
          existing.earliestDate = grn.receiveDate;
        }
      }
    }
  }

  // Convert to daily rate
  const usageMap = new Map<string, number>();
  const now      = Date.now();

  for (const [id, { totalQty, earliestDate }] of totals) {
    const daysCovered = Math.max(1, (now - earliestDate.getTime()) / (1000 * 60 * 60 * 24));
    usageMap.set(id, totalQty / daysCovered);
  }

  return usageMap;
}

// ─── Classify stock status ────────────────────────────────────────────────────

function classifyStatus(daysRemaining: number): StockStatus {
  if (daysRemaining < 3)   return 'critical';
  if (daysRemaining < 7)   return 'warning';
  if (daysRemaining > 30)  return 'overstock';
  return 'ok';
}

// ─── Reorder quantity calculation ────────────────────────────────────────────
// Target: bring stock up to 14 days of safety supply.
// reorderQty = max(0, targetStock - currentStock)

function computeReorderQty(currentStock: number, dailyUsage: number): number {
  const targetStock = dailyUsage * 14; // 14-day safety stock
  return Math.max(0, +(targetStock - currentStock).toFixed(2));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildInventoryPrediction(hotelId: string): Promise<InventoryForecast | null> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // Parallel fetch: ingredients + GRN usage map
  const [ingredients, grnUsage] = await Promise.all([
    Ingredient.find(
      { hotelId: hotelOId },
      { _id: 1, name: 1, unit: 1, currentStock: 1, lowStockThreshold: 1, costPerUnit: 1 },
    ).lean(),
    buildGRNUsageMap(hotelOId),
  ]);

  if (ingredients.length === 0) return null;

  const predictions: IngredientPrediction[] = ingredients.map((ing) => {
    const id = ing._id.toString();

    // Daily usage: GRN-derived if available, else threshold/7 heuristic
    let estimatedDailyUsage: number;
    let usageSource: IngredientPrediction['usageSource'];

    if (grnUsage.has(id) && grnUsage.get(id)! > 0) {
      estimatedDailyUsage = +grnUsage.get(id)!.toFixed(4);
      usageSource         = 'grn';
    } else {
      // Heuristic: lowStockThreshold represents ~7 days of buffer
      estimatedDailyUsage = +(Math.max(ing.lowStockThreshold, 0.01) / 7).toFixed(4);
      usageSource         = 'heuristic';
    }

    const daysRemaining = estimatedDailyUsage > 0
      ? +(ing.currentStock / estimatedDailyUsage).toFixed(1)
      : 9999; // no usage detected → no run-out risk

    const status     = classifyStatus(daysRemaining);
    const reorderQty = status === 'overstock' ? 0 : computeReorderQty(ing.currentStock, estimatedDailyUsage);
    const reorderCost = +(reorderQty * ing.costPerUnit).toFixed(2);

    return {
      ingredientId:        id,
      name:                ing.name,
      unit:                ing.unit,
      currentStock:        +ing.currentStock.toFixed(3),
      lowStockThreshold:   ing.lowStockThreshold,
      costPerUnit:         ing.costPerUnit,
      estimatedDailyUsage,
      daysRemaining:       Math.min(daysRemaining, 9999),
      status,
      reorderQty,
      reorderCost,
      usageSource,
    };
  });

  // Sort by risk (critical first, then warning, then by daysRemaining asc)
  const statusOrder: Record<StockStatus, number> = { critical: 0, warning: 1, ok: 2, overstock: 3 };
  predictions.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    return so !== 0 ? so : a.daysRemaining - b.daysRemaining;
  });

  const criticalItems  = predictions.filter((i) => i.status === 'critical');
  const warningItems   = predictions.filter((i) => i.status === 'warning');
  const healthyItems   = predictions.filter((i) => i.status === 'ok');
  const overstockItems = predictions.filter((i) => i.status === 'overstock');

  const urgentItems    = [...criticalItems, ...warningItems];
  const totalReorderCost = +urgentItems.reduce((s, i) => s + i.reorderCost, 0).toFixed(2);
  const topReorderItems  = [...urgentItems]
    .sort((a, b) => b.reorderCost - a.reorderCost)
    .slice(0, 10);

  return {
    generatedAt:      new Date().toISOString(),
    totalIngredients: ingredients.length,
    criticalItems,
    warningItems,
    overstockItems,
    healthyItems,
    totalReorderCost,
    topReorderItems,
    coverageSummary: {
      criticalCount:  criticalItems.length,
      warningCount:   warningItems.length,
      okCount:        healthyItems.length,
      overstockCount: overstockItems.length,
    },
  };
}
