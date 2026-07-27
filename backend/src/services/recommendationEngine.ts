// ─── Recommendation Engine ────────────────────────────────────────────────────
// All scoring and classification is pure Node.js.
// Gemini generates ONLY the human-readable insight text — never calculates KPIs.

import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import { generateNarrative } from '../utils/geminiNarrative';
import { getCachedNarrative, setCachedNarrative, hashNarrativeInput } from '../utils/aiReportCache';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MenuQuadrant = 'star' | 'plow_horse' | 'puzzle' | 'dog';

export interface MenuItemScore {
  productId:      string;
  productName:    string;
  qty:            number;
  revenue:        number;
  revenuePerUnit: number;  // revenue ÷ qty — proxy for per-unit profitability
  quadrant:       MenuQuadrant;
}

export interface UpsellTarget {
  productName:    string;
  revenuePerUnit: number;
  currentOrders:  number;
  reason:         string;
}

export interface CrossSellPair {
  triggerItem:    string;   // item the customer is likely already ordering
  suggestItem:    string;   // item to suggest alongside
  reason:         string;
}

export interface ComboSuggestion {
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
  menuEngineering: MenuItemScore[];    // all classified items (Stars first)
  stars:           MenuItemScore[];    // high popularity + high margin
  plowHorses:      MenuItemScore[];    // high popularity + low margin → price up
  puzzles:         MenuItemScore[];    // low popularity + high margin → promote
  dogs:            MenuItemScore[];    // low popularity + low margin → review/retire
  upsellTargets:   UpsellTarget[];    // top 5 upsell opportunities
  crossSell:       CrossSellPair[];   // top 3 cross-sell pairings
  combos:          ComboSuggestion[]; // top 3 combo suggestions
  slowMovers:      SlowMover[];       // bottom 10% by qty — candidate for retirement
  highMarginItems: MenuItemScore[];   // top 10 by revenue-per-unit
  insight:         string | null;     // Gemini: 2-3 sentences on menu health
  insightSource:   'cache' | 'gemini' | 'unavailable';
  generatedAt:     string;
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx    = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── BCG-style menu classification ───────────────────────────────────────────

function classifyItems(
  rawItems: Array<{ productId: mongoose.Types.ObjectId; productName: string; qty: number; revenue: number }>,
): MenuItemScore[] {
  if (rawItems.length === 0) return [];

  const scored = rawItems.map((i) => ({
    productId:      i.productId.toString(),
    productName:    i.productName,
    qty:            i.qty,
    revenue:        +i.revenue.toFixed(2),
    revenuePerUnit: i.qty > 0 ? +(i.revenue / i.qty).toFixed(2) : 0,
    quadrant:       'dog' as MenuQuadrant,
  }));

  const medianQty = median(scored.map((i) => i.qty));
  const medianRPU = median(scored.map((i) => i.revenuePerUnit));

  for (const item of scored) {
    const highPopularity   = item.qty            > medianQty;
    const highProfitability = item.revenuePerUnit > medianRPU;

    if (highPopularity && highProfitability)   item.quadrant = 'star';
    else if (highPopularity && !highProfitability) item.quadrant = 'plow_horse';
    else if (!highPopularity && highProfitability)  item.quadrant = 'puzzle';
    else item.quadrant = 'dog';
  }

  // Return Stars first, then Puzzles, then Plow Horses, then Dogs
  return scored.sort((a, b) => {
    const order: Record<MenuQuadrant, number> = { star: 0, puzzle: 1, plow_horse: 2, dog: 3 };
    if (order[a.quadrant] !== order[b.quadrant]) return order[a.quadrant] - order[b.quadrant];
    return b.revenue - a.revenue;
  });
}

// ─── Upsell targets: Puzzles (high margin, under-promoted) ───────────────────

function buildUpsellTargets(classified: MenuItemScore[]): UpsellTarget[] {
  return classified
    .filter((i) => i.quadrant === 'puzzle')
    .sort((a, b) => b.revenuePerUnit - a.revenuePerUnit)
    .slice(0, 5)
    .map((i) => ({
      productName:    i.productName,
      revenuePerUnit: i.revenuePerUnit,
      currentOrders:  i.qty,
      reason:         `High-value item (₹${i.revenuePerUnit}/unit) ordered infrequently — ideal for table upsell or menu spotlight.`,
    }));
}

// ─── Cross-sell: pair Stars with Puzzles (high-traffic + high-margin) ─────────

function buildCrossSell(classified: MenuItemScore[]): CrossSellPair[] {
  const stars   = classified.filter((i) => i.quadrant === 'star').slice(0, 3);
  const puzzles = classified.filter((i) => i.quadrant === 'puzzle').slice(0, 3);

  const pairs: CrossSellPair[] = [];
  for (let i = 0; i < Math.min(stars.length, puzzles.length, 3); i++) {
    pairs.push({
      triggerItem: stars[i].productName,
      suggestItem: puzzles[i].productName,
      reason:      `Customers ordering ${stars[i].productName} are not often buying ${puzzles[i].productName} — a natural pairing opportunity with a high-value add-on.`,
    });
  }
  return pairs;
}

// ─── Combo suggestions: top Star + top Plow Horse + top Puzzle ────────────────

function buildCombos(classified: MenuItemScore[]): ComboSuggestion[] {
  const stars      = classified.filter((i) => i.quadrant === 'star').slice(0, 4);
  const plowHorses = classified.filter((i) => i.quadrant === 'plow_horse').slice(0, 3);
  const puzzles    = classified.filter((i) => i.quadrant === 'puzzle').slice(0, 3);

  const combos: ComboSuggestion[] = [];

  // Combo 1: top star + top puzzle (volume + margin)
  if (stars[0] && puzzles[0]) {
    combos.push({
      items:  [stars[0].productName, puzzles[0].productName],
      reason: `Bundle a best-seller with a high-margin item to increase AOV without discounting.`,
    });
  }

  // Combo 2: two plow horses (high-volume, discount without hurting margin much)
  if (plowHorses[0] && plowHorses[1]) {
    combos.push({
      items:  [plowHorses[0].productName, plowHorses[1].productName],
      reason: `Two popular items together as a value combo — drives volume while maintaining turnover.`,
    });
  }

  // Combo 3: top star + second star + top plow horse (flagship combo)
  if (stars[0] && stars[1] && plowHorses[0]) {
    combos.push({
      items:  [stars[0].productName, stars[1].productName, plowHorses[0].productName],
      reason: `Flagship combo built from your top sellers — great for quick-service or lunch promotions.`,
    });
  }

  return combos;
}

// ─── Slow movers: bottom 10% by qty ──────────────────────────────────────────

function buildSlowMovers(classified: MenuItemScore[]): SlowMover[] {
  if (classified.length < 5) return [];
  const qtyValues = classified.map((i) => i.qty);
  const p10       = percentile(qtyValues, 10);

  return classified
    .filter((i) => i.qty <= p10 && i.quadrant === 'dog')
    .slice(0, 8)
    .map((i) => ({
      productName: i.productName,
      qty:         i.qty,
      revenue:     i.revenue,
      suggestion:  i.revenue < 200
        ? `Consider removing from menu or replacing — very low volume and revenue.`
        : `Low orders but some revenue — test a price reduction or add-on pairing before retiring.`,
    }));
}

// ─── Gemini insight prompt ────────────────────────────────────────────────────
// All numbers are pre-computed. Gemini only writes the narrative.

function buildInsightPrompt(
  date:         string,
  classified:   MenuItemScore[],
  upsell:       UpsellTarget[],
  slowMovers:   SlowMover[],
): string {
  const stars      = classified.filter((i) => i.quadrant === 'star').slice(0, 3);
  const puzzles    = classified.filter((i) => i.quadrant === 'puzzle').slice(0, 3);
  const dogs       = classified.filter((i) => i.quadrant === 'dog');
  const topUpsell  = upsell[0];
  const topSlow    = slowMovers[0];

  const starList    = stars.map((i)   => `${i.productName} (${i.qty} orders, ₹${i.revenuePerUnit}/unit)`).join(', ') || 'None';
  const puzzleList  = puzzles.map((i) => `${i.productName} (₹${i.revenuePerUnit}/unit, only ${i.qty} orders)`).join(', ') || 'None';

  return `You are a restaurant menu consultant. All numbers below are pre-calculated. Do not recalculate.

Date: ${date}
Menu items analysed: ${classified.length}

Menu Quadrant Summary:
- Stars (high demand + high margin): ${stars.length} items — ${starList}
- Puzzles (high margin, low demand): ${puzzles.length} items — ${puzzleList}
- Plow Horses (high demand, low margin): ${classified.filter((i) => i.quadrant === 'plow_horse').length} items
- Dogs (low demand + low margin): ${dogs.length} items

Top upsell opportunity: ${topUpsell ? `${topUpsell.productName} (₹${topUpsell.revenuePerUnit}/unit, only ${topUpsell.currentOrders} orders today)` : 'None'}
Top slow mover to review: ${topSlow ? `${topSlow.productName} (only ${topSlow.qty} orders, ₹${topSlow.revenue} revenue)` : 'None'}

Write a concise menu health insight with exactly two parts:

## Menu Health
One sentence on overall menu performance balance.

## Priority Action
Two bullet points (use –) with specific, implementable actions for today or tomorrow.

Total: 60–90 words. Direct, professional tone.`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildRecommendations(
  hotelId: string,
  date:    string,
): Promise<RecommendationSet | null> {
  const today    = new Date().toISOString().slice(0, 10);
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // Use allItems (top 100 by revenue, has both qty and revenue) — no Order scan needed
  const snap = await DailySnapshot.findOne(
    { hotelId: hotelOId, date },
    { allItems: 1, topItems: 1, totalRevenue: 1 },
  ).lean();

  if (!snap || snap.allItems.length === 0) return null;

  // ── Classification (all Node.js) ──────────────────────────────────────────
  const classified    = classifyItems(snap.allItems);
  const stars         = classified.filter((i) => i.quadrant === 'star');
  const plowHorses    = classified.filter((i) => i.quadrant === 'plow_horse');
  const puzzles       = classified.filter((i) => i.quadrant === 'puzzle');
  const dogs          = classified.filter((i) => i.quadrant === 'dog');
  const upsellTargets = buildUpsellTargets(classified);
  const crossSell     = buildCrossSell(classified);
  const combos        = buildCombos(classified);
  const slowMovers    = buildSlowMovers(classified);
  const highMarginItems = [...classified]
    .sort((a, b) => b.revenuePerUnit - a.revenuePerUnit)
    .slice(0, 10);

  // ── Gemini insight (cached, optional) ────────────────────────────────────
  const insightInput = {
    date,
    itemCount:   classified.length,
    starsCount:  stars.length,
    puzzleCount: puzzles.length,
    dogCount:    dogs.length,
    topStar:     stars[0]?.productName,
    topUpsell:   upsellTargets[0]?.productName,
  };
  const inputHash = hashNarrativeInput(insightInput);

  let insight: string | null              = null;
  let insightSource: RecommendationSet['insightSource'] = 'unavailable';

  const cached = await getCachedNarrative(hotelId, `rec:${date}`, inputHash);
  if (cached) {
    insight       = cached;
    insightSource = 'cache';
  } else {
    const prompt    = buildInsightPrompt(date, classified, upsellTargets, slowMovers);
    const generated = await generateNarrative(prompt);
    if (generated) {
      insight       = generated;
      insightSource = 'gemini';
      await setCachedNarrative(hotelId, `rec:${date}`, inputHash, generated, date === today);
    }
  }

  return {
    date,
    menuEngineering: classified,
    stars,
    plowHorses,
    puzzles,
    dogs,
    upsellTargets,
    crossSell,
    combos,
    slowMovers,
    highMarginItems,
    insight,
    insightSource,
    generatedAt: new Date().toISOString(),
  };
}
