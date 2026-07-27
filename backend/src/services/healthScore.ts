// ─── Restaurant Health Score ──────────────────────────────────────────────────
// All inputs are pre-computed KPIs from DailySnapshot.
// Gemini is NOT involved here — this is pure Node.js arithmetic.

export interface HealthScoreComponents {
  revenueTrend:      number;  // 0–25
  orderTrend:        number;  // 0–20
  cancellationRate:  number;  // 0–20
  aovStability:      number;  // 0–15
  peakConcentration: number;  // 0–10  (lower peak % = more resilient)
  sourceDiversity:   number;  // 0–10
}

export interface HealthScore {
  score:      number;   // 0–100, sum of components
  grade:      'A' | 'B' | 'C' | 'D' | 'F';
  components: HealthScoreComponents;
}

// Structural type — any object with these fields satisfies this contract,
// including lean Mongoose DailySnapshot documents.
export type SnapForScore = {
  totalRevenue:         number;
  totalOrders:          number;
  cancelledOrders:      number;
  avgOrderValue:        number;
  revenueVs7DayAvgPct: number | null;
  ordersVs7DayAvgPct:  number | null;
  peakHourRevenue:      number;
  sourceBreakdown: {
    dineIn:   number;
    takeaway: number;
    qr:       number;
    swiggy:   number;
    zomato:   number;
    other:    number;
  };
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function trendPts(pct: number | null, maxPts: number): number {
  if (pct === null) return Math.round(maxPts * 0.6); // neutral: no history
  if (pct > 20)  return maxPts;
  if (pct > 5)   return Math.round(maxPts * 0.80);
  if (pct > -5)  return Math.round(maxPts * 0.60);
  if (pct > -20) return Math.round(maxPts * 0.32);
  return 0;
}

function toGrade(score: number): HealthScore['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 health score for a single day's performance.
 *
 * @param snap    Lean DailySnapshot (or any object matching SnapForScore).
 * @param last7   Up to 7 prior snapshots for AOV stability comparison.
 *                Pass [] when unavailable — that component defaults to neutral.
 */
export function computeHealthScore(
  snap:   SnapForScore,
  last7:  { avgOrderValue: number }[],
): HealthScore {
  // ── 1. Revenue trend (0–25) ────────────────────────────────────────────────
  const revenueTrend = trendPts(snap.revenueVs7DayAvgPct, 25);

  // ── 2. Order volume trend (0–20) ──────────────────────────────────────────
  const orderTrend = trendPts(snap.ordersVs7DayAvgPct, 20);

  // ── 3. Cancellation rate (0–20) ───────────────────────────────────────────
  const totalAttempted = snap.totalOrders + snap.cancelledOrders;
  let cancellationRate: number;
  if (totalAttempted === 0) {
    cancellationRate = 12; // neutral: nothing to measure
  } else {
    const pct = (snap.cancelledOrders / totalAttempted) * 100;
    if (pct < 2)   cancellationRate = 20;
    else if (pct < 5)  cancellationRate = 15;
    else if (pct < 10) cancellationRate = 8;
    else cancellationRate = 2;
  }

  // ── 4. AOV stability vs 7-day average (0–15) ──────────────────────────────
  let aovStability: number;
  if (last7.length < 3 || snap.avgOrderValue === 0) {
    aovStability = 9; // neutral: insufficient history
  } else {
    const avgAOV = last7.reduce((s, d) => s + d.avgOrderValue, 0) / last7.length;
    if (avgAOV === 0) {
      aovStability = 9;
    } else {
      const diffPct = Math.abs(((snap.avgOrderValue - avgAOV) / avgAOV) * 100);
      if (diffPct < 10)  aovStability = 15;
      else if (diffPct < 25) aovStability = 10;
      else aovStability = 5;
    }
  }

  // ── 5. Peak-hour concentration (0–10) ─────────────────────────────────────
  // Lower single-hour dominance = more resilient revenue distribution
  let peakConcentration: number;
  if (snap.totalRevenue === 0) {
    peakConcentration = 7;
  } else {
    const peakRatio = snap.peakHourRevenue / snap.totalRevenue;
    if (peakRatio < 0.25)      peakConcentration = 10;
    else if (peakRatio < 0.40) peakConcentration = 8;
    else if (peakRatio < 0.60) peakConcentration = 6;
    else                       peakConcentration = 4;
  }

  // ── 6. Order source diversity (0–10) ──────────────────────────────────────
  const { sourceBreakdown: sb } = snap;
  const activeSources = [sb.dineIn, sb.takeaway, sb.qr, sb.swiggy, sb.zomato, sb.other]
    .filter((v) => v > 0).length;

  let sourceDiversity: number;
  if (activeSources === 0)       sourceDiversity = 7; // neutral: no data
  else if (activeSources === 1)  sourceDiversity = 4; // monoculture risk
  else if (activeSources === 2)  sourceDiversity = 7;
  else                           sourceDiversity = 10;

  // ── Total ──────────────────────────────────────────────────────────────────
  const score = Math.min(100,
    revenueTrend + orderTrend + cancellationRate + aovStability + peakConcentration + sourceDiversity,
  );

  return {
    score,
    grade:      toGrade(score),
    components: { revenueTrend, orderTrend, cancellationRate, aovStability, peakConcentration, sourceDiversity },
  };
}
