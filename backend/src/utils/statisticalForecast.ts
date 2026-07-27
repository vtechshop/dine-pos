// ─── Statistical Forecast Utilities ──────────────────────────────────────────
// Pure math — no I/O, no external dependencies.
// Gemini must NEVER receive raw series or calculate forecast values.

export type ForecastMethod = 'wma' | 'holt_linear' | 'holt_winters';

export interface ForecastResult {
  values:     number[];      // one value per horizon step
  method:     ForecastMethod;
  confidence: number;        // 0-1 (higher = more confident)
  mape:       number;        // mean absolute % error from hold-out backtesting
}

// ─── Weighted Moving Average ──────────────────────────────────────────────────
// Default: linear decay weights — recent values carry more weight.

export function wma(
  values:     number[],
  windowSize: number = Math.min(7, values.length),
  weights?:   number[],
): number {
  if (values.length === 0) return 0;
  const win = values.slice(-windowSize);
  const w   = weights ?? win.map((_, i) => i + 1); // 1,2,...n — oldest=1, newest=n
  const wSum = w.reduce((a, b) => a + b, 0);
  return wSum > 0 ? win.reduce((sum, v, i) => sum + v * w[i], 0) / wSum : 0;
}

// ─── Single Exponential Smoothing ────────────────────────────────────────────
// Good for stationary data (no trend, no seasonality).
// Returns the next single-step forecast.

export function simpleES(values: number[], alpha: number = 0.3): number {
  if (values.length === 0) return 0;
  let s = values[0];
  for (let i = 1; i < values.length; i++) {
    s = alpha * values[i] + (1 - alpha) * s;
  }
  return s;
}

// ─── Holt Linear (Double Exponential Smoothing) ───────────────────────────────
// Captures level + trend. Returns `horizon` forecast values.

export function holtLinear(
  values:  number[],
  alpha:   number = 0.3,
  beta:    number = 0.1,
  horizon: number = 7,
): number[] {
  if (values.length === 0) return Array(horizon).fill(0);

  let l = values[0];
  let b = values.length > 1 ? (values[values.length - 1] - values[0]) / (values.length - 1) : 0;

  for (let i = 1; i < values.length; i++) {
    const prevL = l;
    l = alpha * values[i] + (1 - alpha) * (l + b);
    b = beta * (l - prevL) + (1 - beta) * b;
  }

  return Array.from({ length: horizon }, (_, h) => Math.max(0, l + (h + 1) * b));
}

// ─── Holt-Winters (Triple Exponential Smoothing) ─────────────────────────────
// Captures level + trend + weekly seasonality (period=7).
// Falls back to Holt Linear when data is insufficient (< 2 full periods).

export function holtWinters(
  values:  number[],
  alpha:   number = 0.3,
  beta:    number = 0.1,
  gamma:   number = 0.2,
  period:  number = 7,
  horizon: number = 7,
): number[] {
  const n = values.length;
  if (n < period * 2) return holtLinear(values, alpha, beta, horizon);

  // Initial seasonal factors from the first complete period
  const avgFirst = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const seasons: number[] = values
    .slice(0, period)
    .map((v) => (avgFirst > 0 ? v / avgFirst : 1));

  const avgSecond = values.slice(period, period * 2).reduce((a, b) => a + b, 0) / period;
  let l = avgFirst;
  let b = (avgSecond - avgFirst) / period;

  for (let i = 0; i < n; i++) {
    const sIdx  = i % period;
    const prevL = l;
    const sv    = seasons[sIdx] || 1;
    l = alpha * (values[i] / sv) + (1 - alpha) * (l + b);
    b = beta * (l - prevL) + (1 - beta) * b;
    seasons[sIdx] = gamma * (values[i] / l) + (1 - gamma) * sv;
  }

  return Array.from({ length: horizon }, (_, h) => {
    const sIdx = (n + h) % period;
    return Math.max(0, (l + (h + 1) * b) * (seasons[sIdx] || 1));
  });
}

// ─── Backtesting + confidence ─────────────────────────────────────────────────

function computeMAPE(actuals: number[], forecasts: number[]): number {
  const pairs = actuals
    .map((a, i) => ({ a, f: forecasts[i] ?? 0 }))
    .filter((p) => p.a > 0);
  if (pairs.length === 0) return 40; // no valid pairs → moderate error assumed
  const sumPct = pairs.reduce((s, { a, f }) => s + Math.abs((a - f) / a), 0);
  return (sumPct / pairs.length) * 100;
}

function backtestMAPE(
  values:  number[],
  method:  ForecastMethod,
  horizon: number,
  period:  number,
): number {
  const testSize = Math.min(horizon, Math.max(1, Math.floor(values.length * 0.2)));
  const train    = values.slice(0, -testSize);
  const actuals  = values.slice(-testSize);
  if (train.length < 3) return 35; // insufficient training data

  let forecasted: number[];
  switch (method) {
    case 'holt_winters':
      forecasted = holtWinters(train, 0.3, 0.1, 0.2, period, testSize);
      break;
    case 'holt_linear':
      forecasted = holtLinear(train, 0.3, 0.1, testSize);
      break;
    default: {
      const v = simpleES(train);
      forecasted = Array(testSize).fill(v);
    }
  }

  return computeMAPE(actuals, forecasted);
}

function confidenceFromMAPE(mapeVal: number): number {
  // MAPE 0% → 1.0, MAPE 50%+ → 0.3 (floor: predictions still directionally useful)
  return Math.max(0.30, Math.min(1.0, 1 - mapeVal / 100));
}

// ─── Auto-select algorithm ────────────────────────────────────────────────────
// Holt-Winters if ≥14 data points, Holt Linear if ≥5, WMA otherwise.

export function autoForecast(
  values:  number[],
  horizon: number,
  period:  number = 7,
): ForecastResult {
  const n = values.length;

  let method: ForecastMethod;
  let forecast: number[];

  if (n >= period * 2) {
    method   = 'holt_winters';
    forecast = holtWinters(values, 0.3, 0.1, 0.2, period, horizon);
  } else if (n >= 5) {
    method   = 'holt_linear';
    forecast = holtLinear(values, 0.3, 0.1, horizon);
  } else {
    method   = 'wma';
    const v  = n > 0 ? wma(values) : 0;
    forecast = Array(horizon).fill(v);
  }

  const mapeVal    = backtestMAPE(values, method, horizon, period);
  const confidence = confidenceFromMAPE(mapeVal);

  return {
    values:     forecast.map((v) => +v.toFixed(2)),
    method,
    confidence: +confidence.toFixed(3),
    mape:       +mapeVal.toFixed(1),
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
