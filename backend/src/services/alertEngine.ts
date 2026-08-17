// ─── Smart Alert Engine ───────────────────────────────────────────────────────
// All detection logic is pure Node.js arithmetic over pre-aggregated data.
// Gemini is NOT used here — alerts are deterministic threshold checks.

import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import HourlyMetrics from '../models/HourlyMetrics';
import Order from '../models/Order';
import Ingredient from '../models/Ingredient';
import Alert from '../models/Alert';
import { toBusinessDate } from '../utils/businessDate';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertType =
  | 'sales_drop'
  | 'revenue_spike'
  | 'avg_bill_decrease'
  | 'table_utilization_drop'
  | 'kitchen_delay'
  | 'low_inventory'
  | 'excessive_cancellations'
  | 'discount_anomaly'
  | 'payment_anomaly';

export interface SmartAlert {
  type:      AlertType;
  severity:  AlertSeverity;
  title:     string;
  message:   string;
  value:     number;       // current observed value
  baseline:  number;       // expected baseline
  changePct: number | null;
}

export interface AlertResult {
  date:       string;
  alerts:     SmartAlert[];
  checkedAt:  string;
  dataSource: 'snapshot' | 'realtime';
}

// ─── Detection thresholds ─────────────────────────────────────────────────────

const T = {
  salesDrop:          { warning: -20, critical: -35 },  // % vs baseline
  revenueSpike:       { info: +40, warning: +80 },
  avgBillDrop:        { warning: -12, critical: -22 },
  tableUtilDrop:      { warning: -25, critical: -45 },
  cancellationRate:   { warning: 6, critical: 12 },    // % of total attempts
  kitchenDelayMins:   25,                              // minutes before order is "delayed"
  kitchenDelayCount:  { warning: 3, critical: 7 },     // number of delayed orders
  paymentCashSpike:   20,                              // pp shift in cash % vs baseline
  discountAnomalyAov: -15,                             // AOV drop % without revenue volume explanation
} as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function changePct(current: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return +((current - baseline) / baseline * 100).toFixed(1);
}

function maybeAlert(
  type:      AlertType,
  value:     number,
  baseline:  number,
  pct:       number | null,
  thresholds: { warning?: number; critical?: number; info?: number },
  titles:    { critical?: string; warning?: string; info?: string },
  messages:  { critical?: string; warning?: string; info?: string },
): SmartAlert | null {
  if (pct === null) return null;

  let severity: AlertSeverity | null = null;
  if (thresholds.critical !== undefined && (thresholds.critical < 0 ? pct <= thresholds.critical : pct >= thresholds.critical)) {
    severity = 'critical';
  } else if (thresholds.warning !== undefined && (thresholds.warning < 0 ? pct <= thresholds.warning : pct >= thresholds.warning)) {
    severity = 'warning';
  } else if (thresholds.info !== undefined && (thresholds.info < 0 ? pct <= thresholds.info : pct >= thresholds.info)) {
    severity = 'info';
  }

  if (!severity) return null;

  return {
    type,
    severity,
    title:     titles[severity] ?? type,
    message:   messages[severity] ?? '',
    value:     +value.toFixed(2),
    baseline:  +baseline.toFixed(2),
    changePct: pct,
  };
}

// ─── Snapshot-based detectors (usable for both today & past dates) ────────────

interface SnapMetrics {
  revenue:          number;
  orderCount:       number;
  cancelledCount:   number;
  avgOrderValue:    number;
  uniqueTables:     number;
  cashRevenue:      number;
  totalPayment:     number;
}

interface Baseline {
  avgRevenue:       number;
  avgOrders:        number;
  avgCancellations: number;
  avgAOV:           number;
  avgTables:        number;
  avgCashPct:       number;
}

function detectSalesDrop(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  const pct = changePct(current.revenue, baseline.avgRevenue);
  return maybeAlert(
    'sales_drop', current.revenue, baseline.avgRevenue, pct,
    { warning: T.salesDrop.warning, critical: T.salesDrop.critical },
    { critical: 'Critical Sales Drop', warning: 'Sales Below Baseline' },
    {
      critical: `Revenue ₹${current.revenue.toFixed(0)} is ${Math.abs(pct!).toFixed(0)}% below the 7-day average (₹${baseline.avgRevenue.toFixed(0)}).`,
      warning:  `Revenue is tracking ${Math.abs(pct!).toFixed(0)}% below the 7-day average of ₹${baseline.avgRevenue.toFixed(0)}.`,
    },
  );
}

function detectRevenueSpike(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  const pct = changePct(current.revenue, baseline.avgRevenue);
  return maybeAlert(
    'revenue_spike', current.revenue, baseline.avgRevenue, pct,
    { warning: T.revenueSpike.warning, info: T.revenueSpike.info },
    { warning: 'Unusual Revenue Spike — Verify', info: 'Strong Revenue Day' },
    {
      warning: `Revenue ₹${current.revenue.toFixed(0)} is ${pct!.toFixed(0)}% above average. Verify data integrity.`,
      info:    `Revenue ₹${current.revenue.toFixed(0)} is ${pct!.toFixed(0)}% above the 7-day average.`,
    },
  );
}

function detectAvgBillDecrease(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  const pct = changePct(current.avgOrderValue, baseline.avgAOV);
  return maybeAlert(
    'avg_bill_decrease', current.avgOrderValue, baseline.avgAOV, pct,
    { warning: T.avgBillDrop.warning, critical: T.avgBillDrop.critical },
    { critical: 'Average Bill Sharply Lower', warning: 'Average Bill Falling' },
    {
      critical: `Average bill ₹${current.avgOrderValue.toFixed(0)} is ${Math.abs(pct!).toFixed(0)}% below the 7-day avg of ₹${baseline.avgAOV.toFixed(0)}.`,
      warning:  `Average bill dropped ${Math.abs(pct!).toFixed(0)}% vs 7-day average. Check for unusual discounting.`,
    },
  );
}

function detectTableUtilizationDrop(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  if (baseline.avgTables < 1) return null;
  const pct = changePct(current.uniqueTables, baseline.avgTables);
  return maybeAlert(
    'table_utilization_drop', current.uniqueTables, baseline.avgTables, pct,
    { warning: T.tableUtilDrop.warning, critical: T.tableUtilDrop.critical },
    { critical: 'Table Utilization Critical Low', warning: 'Table Utilization Below Average' },
    {
      critical: `Only ${current.uniqueTables} tables served vs avg ${baseline.avgTables.toFixed(0)}. Possible walkouts or slow service.`,
      warning:  `Table count (${current.uniqueTables}) is ${Math.abs(pct!).toFixed(0)}% below the 7-day average.`,
    },
  );
}

function detectExcessiveCancellations(current: SnapMetrics): SmartAlert | null {
  const total = current.orderCount + current.cancelledCount;
  if (total < 5) return null; // not enough volume to be meaningful
  const ratePct = (current.cancelledCount / total) * 100;

  if (ratePct >= T.cancellationRate.critical) {
    return {
      type: 'excessive_cancellations', severity: 'critical',
      title:   'High Cancellation Rate',
      message: `${current.cancelledCount} cancellations out of ${total} attempts (${ratePct.toFixed(1)}%). Check kitchen capacity or order accuracy.`,
      value: ratePct, baseline: T.cancellationRate.warning, changePct: null,
    };
  }
  if (ratePct >= T.cancellationRate.warning) {
    return {
      type: 'excessive_cancellations', severity: 'warning',
      title:   'Elevated Cancellation Rate',
      message: `${current.cancelledCount} cancelled orders (${ratePct.toFixed(1)}%). Monitor kitchen load.`,
      value: ratePct, baseline: T.cancellationRate.warning, changePct: null,
    };
  }
  return null;
}

function detectDiscountAnomaly(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  // Proxy: AOV drops but order volume is normal or up → possible excess discounting
  if (baseline.avgAOV === 0) return null;
  const aovPct = changePct(current.avgOrderValue, baseline.avgAOV);
  if (aovPct === null || aovPct > T.discountAnomalyAov) return null;

  const ordersPct = changePct(current.orderCount, baseline.avgOrders);
  // If orders are also down, this is a normal sales drop — not a discount anomaly
  if (ordersPct !== null && ordersPct < -10) return null;

  return {
    type: 'discount_anomaly', severity: 'warning',
    title:   'Possible Discount Anomaly',
    message: `Average bill is ${Math.abs(aovPct).toFixed(0)}% below baseline but order count is normal. Check for unusual discounting or bill edits.`,
    value:     current.avgOrderValue,
    baseline:  baseline.avgAOV,
    changePct: aovPct,
  };
}

function detectPaymentAnomaly(current: SnapMetrics, baseline: Baseline): SmartAlert | null {
  if (current.totalPayment < 1000 || baseline.avgCashPct === 0) return null;
  const currentCashPct = current.totalPayment > 0
    ? (current.cashRevenue / current.totalPayment) * 100
    : 0;
  const shift = currentCashPct - baseline.avgCashPct;

  if (shift >= T.paymentCashSpike) {
    return {
      type: 'payment_anomaly', severity: 'warning',
      title:   'Unusual Cash Payment Spike',
      message: `Cash payments are ${currentCashPct.toFixed(0)}% of revenue vs baseline ${baseline.avgCashPct.toFixed(0)}%. Possible card/UPI terminal issue.`,
      value:    currentCashPct,
      baseline: baseline.avgCashPct,
      changePct: +shift.toFixed(1),
    };
  }
  return null;
}

// ─── Realtime-only detectors (today only) ────────────────────────────────────

async function detectKitchenDelay(hotelOId: mongoose.Types.ObjectId): Promise<SmartAlert | null> {
  const now           = new Date();
  const startOfToday  = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const cutoff        = new Date(now.getTime() - T.kitchenDelayMins * 60_000);

  const delayed = await Order.countDocuments({
    hotelId: hotelOId,
    status:  { $in: ['pending', 'preparing'] },
    createdAt: { $gte: startOfToday, $lt: cutoff },
  });

  if (delayed >= T.kitchenDelayCount.critical) {
    return {
      type: 'kitchen_delay', severity: 'critical',
      title:   'Kitchen Severely Behind',
      message: `${delayed} orders have been waiting over ${T.kitchenDelayMins} minutes without completion.`,
      value: delayed, baseline: T.kitchenDelayCount.warning, changePct: null,
    };
  }
  if (delayed >= T.kitchenDelayCount.warning) {
    return {
      type: 'kitchen_delay', severity: 'warning',
      title:   'Kitchen Running Behind',
      message: `${delayed} orders pending for more than ${T.kitchenDelayMins} minutes. Check kitchen capacity.`,
      value: delayed, baseline: T.kitchenDelayCount.warning, changePct: null,
    };
  }
  return null;
}

async function detectLowInventory(hotelOId: mongoose.Types.ObjectId): Promise<SmartAlert | null> {
  const lowItems = await Ingredient.find(
    { hotelId: hotelOId, $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } },
    { name: 1, currentStock: 1, unit: 1 },
  ).limit(10).lean();

  if (lowItems.length === 0) return null;

  const severity: AlertSeverity = lowItems.length >= 5 ? 'critical' : 'warning';
  const itemList = lowItems.slice(0, 5).map((i) => `${i.name} (${i.currentStock}${i.unit})`).join(', ');

  return {
    type: 'low_inventory', severity,
    title:   `${lowItems.length} Low Stock Item${lowItems.length > 1 ? 's' : ''}`,
    message: `${itemList}${lowItems.length > 5 ? ` and ${lowItems.length - 5} more` : ''} are at or below reorder threshold.`,
    value: lowItems.length, baseline: 0, changePct: null,
  };
}

// ─── Build baseline from last 7 snapshots ────────────────────────────────────

function buildBaseline(
  snaps: Array<{
    totalRevenue: number;
    totalOrders:  number;
    cancelledOrders: number;
    avgOrderValue: number;
    uniqueTables:  number;
    paymentBreakdown: { cash: number; upi: number; card: number; split: number };
  }>,
): Baseline {
  if (snaps.length === 0) {
    return { avgRevenue: 0, avgOrders: 0, avgCancellations: 0, avgAOV: 0, avgTables: 0, avgCashPct: 0 };
  }
  const n = snaps.length;
  const sum = snaps.reduce(
    (acc, s) => {
      const payment = s.paymentBreakdown.cash + s.paymentBreakdown.upi + s.paymentBreakdown.card + s.paymentBreakdown.split;
      const cashPct = payment > 0 ? (s.paymentBreakdown.cash / payment) * 100 : 0;
      return {
        revenue:    acc.revenue + s.totalRevenue,
        orders:     acc.orders  + s.totalOrders,
        cancelled:  acc.cancelled + s.cancelledOrders,
        aov:        acc.aov + s.avgOrderValue,
        tables:     acc.tables + s.uniqueTables,
        cashPct:    acc.cashPct + cashPct,
      };
    },
    { revenue: 0, orders: 0, cancelled: 0, aov: 0, tables: 0, cashPct: 0 },
  );

  return {
    avgRevenue:       +(sum.revenue   / n).toFixed(2),
    avgOrders:        +(sum.orders    / n).toFixed(1),
    avgCancellations: +(sum.cancelled / n).toFixed(1),
    avgAOV:           +(sum.aov       / n).toFixed(2),
    avgTables:        +(sum.tables    / n).toFixed(1),
    avgCashPct:       +(sum.cashPct   / n).toFixed(1),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function computeAlerts(
  hotelId: string,
  date:    string,
): Promise<AlertResult> {
  const today    = new Date().toISOString().slice(0, 10);
  const isToday  = date === today;
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  let current: SnapMetrics | null = null;
  let dataSource: AlertResult['dataSource'] = 'snapshot';

  if (isToday) {
    // ── Today: aggregate from HourlyMetrics ──────────────────────────────────
    dataSource = 'realtime';
    const currentUTCHour = new Date().getUTCHours();

    // Only produce alerts if at least 4 hours of trading data exist
    if (currentUTCHour < 4) {
      return { date, alerts: [], checkedAt: new Date().toISOString(), dataSource };
    }

    const [agg] = await HourlyMetrics.aggregate([
      { $match: { hotelId: hotelOId, date: today } },
      {
        $group: {
          _id:            null,
          revenue:        { $sum: '$revenue' },
          orderCount:     { $sum: '$orderCount' },
          cancelledCount: { $sum: '$cancelledCount' },
          uniqueTables:   { $sum: '$uniqueTables' },
          cash:           { $sum: '$paymentBreakdown.cash' },
          upi:            { $sum: '$paymentBreakdown.upi' },
          card:           { $sum: '$paymentBreakdown.card' },
          split:          { $sum: '$paymentBreakdown.split' },
        },
      },
    ]);

    if (!agg) {
      return { date, alerts: [], checkedAt: new Date().toISOString(), dataSource };
    }

    const totalPayment = agg.cash + agg.upi + agg.card + agg.split;
    const orderCount   = agg.orderCount;
    current = {
      revenue:        +(agg.revenue).toFixed(2),
      orderCount,
      cancelledCount: agg.cancelledCount,
      avgOrderValue:  orderCount > 0 ? +(agg.revenue / orderCount).toFixed(2) : 0,
      uniqueTables:   agg.uniqueTables,
      cashRevenue:    agg.cash,
      totalPayment,
    };

    // Prorate: compare today's partial total against the same fraction of the 7-day avg
    // proratedFactor = (hoursElapsed) / 24
    const proratedFactor = (currentUTCHour + 1) / 24;
    // Stored in `current` unchanged; baseline will be prorated below

    const last7 = await DailySnapshot.find(
      { hotelId: hotelOId, date: { $lt: today } },
      { totalRevenue: 1, totalOrders: 1, cancelledOrders: 1, avgOrderValue: 1,
        uniqueTables: 1, paymentBreakdown: 1 },
    ).sort({ date: -1 }).limit(7).lean();

    if (last7.length < 3) {
      // Not enough history for meaningful comparison — only run realtime checks
      const alerts: SmartAlert[] = [];
      const cancAlert = detectExcessiveCancellations(current);
      if (cancAlert) alerts.push(cancAlert);
      const [kdAlert, invAlert] = await Promise.all([
        detectKitchenDelay(hotelOId),
        detectLowInventory(hotelOId),
      ]);
      if (kdAlert)  alerts.push(kdAlert);
      if (invAlert) alerts.push(invAlert);
      return { date, alerts, checkedAt: new Date().toISOString(), dataSource };
    }

    const rawBaseline = buildBaseline(last7);
    // Apply proration to make today's partial totals comparable to historical dailies
    const baseline: Baseline = {
      avgRevenue:       +(rawBaseline.avgRevenue  * proratedFactor).toFixed(2),
      avgOrders:        +(rawBaseline.avgOrders   * proratedFactor).toFixed(2),
      avgCancellations: +(rawBaseline.avgCancellations * proratedFactor).toFixed(2),
      avgAOV:            rawBaseline.avgAOV,    // AOV is a ratio, not a total
      avgTables:        +(rawBaseline.avgTables  * proratedFactor).toFixed(2),
      avgCashPct:        rawBaseline.avgCashPct, // percentage, no proration
    };

    const candidates = [
      detectSalesDrop(current, baseline),
      detectRevenueSpike(current, baseline),
      detectAvgBillDecrease(current, baseline),
      detectTableUtilizationDrop(current, baseline),
      detectExcessiveCancellations(current),
      detectDiscountAnomaly(current, baseline),
      detectPaymentAnomaly(current, baseline),
    ];

    const [kdAlert, invAlert] = await Promise.all([
      detectKitchenDelay(hotelOId),
      detectLowInventory(hotelOId),
    ]);
    if (kdAlert)  candidates.push(kdAlert);
    if (invAlert) candidates.push(invAlert);

    const alerts = candidates.filter((a): a is SmartAlert => a !== null);

    // ── Persist alerts to MongoDB (upsert — deduplicate by type+date) ────────
    const dedupDate = toBusinessDate(new Date(), 'Asia/Kolkata');
    if (alerts.length > 0) {
      const upsertOps = alerts.map((a) => ({
        updateOne: {
          filter: { hotelId: hotelOId, type: a.type, dedupDate },
          update: {
            $set: {
              severity:  a.severity,
              title:     a.title,
              message:   a.message,
              value:     a.value,
              baseline:  a.baseline,
              changePct: a.changePct,
              resolvedAt: null,
            },
            $setOnInsert: { isRead: false, readAt: null },
          },
          upsert: true,
        },
      }));
      await Alert.bulkWrite(upsertOps, { ordered: false }).catch(() => {});

      // Mark old alerts of types NOT in today's compute as resolved
      const activeTypes = alerts.map((a) => a.type);
      await Alert.updateMany(
        { hotelId: hotelOId, dedupDate, type: { $nin: activeTypes }, resolvedAt: null },
        { $set: { resolvedAt: new Date() } },
      ).catch(() => {});
    }

    return { date, alerts, checkedAt: new Date().toISOString(), dataSource };

  } else {
    // ── Past date: use DailySnapshot ─────────────────────────────────────────
    const [snap, last7] = await Promise.all([
      DailySnapshot.findOne(
        { hotelId: hotelOId, date },
        { totalRevenue: 1, totalOrders: 1, cancelledOrders: 1, avgOrderValue: 1,
          uniqueTables: 1, paymentBreakdown: 1 },
      ).lean(),
      DailySnapshot.find(
        { hotelId: hotelOId, date: { $lt: date } },
        { totalRevenue: 1, totalOrders: 1, cancelledOrders: 1, avgOrderValue: 1,
          uniqueTables: 1, paymentBreakdown: 1 },
      ).sort({ date: -1 }).limit(7).lean(),
    ]);

    if (!snap) {
      return { date, alerts: [], checkedAt: new Date().toISOString(), dataSource };
    }

    const totalPayment = snap.paymentBreakdown.cash + snap.paymentBreakdown.upi
      + snap.paymentBreakdown.card + snap.paymentBreakdown.split;

    current = {
      revenue:        snap.totalRevenue,
      orderCount:     snap.totalOrders,
      cancelledCount: snap.cancelledOrders,
      avgOrderValue:  snap.avgOrderValue,
      uniqueTables:   snap.uniqueTables,
      cashRevenue:    snap.paymentBreakdown.cash,
      totalPayment,
    };

    if (last7.length < 3) {
      const alerts: SmartAlert[] = [];
      const cancAlert = detectExcessiveCancellations(current);
      if (cancAlert) alerts.push(cancAlert);
      return { date, alerts, checkedAt: new Date().toISOString(), dataSource };
    }

    const baseline = buildBaseline(last7);

    const alerts = [
      detectSalesDrop(current, baseline),
      detectRevenueSpike(current, baseline),
      detectAvgBillDecrease(current, baseline),
      detectTableUtilizationDrop(current, baseline),
      detectExcessiveCancellations(current),
      detectDiscountAnomaly(current, baseline),
      detectPaymentAnomaly(current, baseline),
    ].filter((a): a is SmartAlert => a !== null);

    // ── Persist alerts to MongoDB (upsert — deduplicate by type+date) ────────
    const dedupDate = toBusinessDate(new Date(), 'Asia/Kolkata');
    if (alerts.length > 0) {
      const upsertOps = alerts.map((a) => ({
        updateOne: {
          filter: { hotelId: hotelOId, type: a.type, dedupDate },
          update: {
            $set: {
              severity:  a.severity,
              title:     a.title,
              message:   a.message,
              value:     a.value,
              baseline:  a.baseline,
              changePct: a.changePct,
              resolvedAt: null,
            },
            $setOnInsert: { isRead: false, readAt: null },
          },
          upsert: true,
        },
      }));
      await Alert.bulkWrite(upsertOps, { ordered: false }).catch(() => {});

      // Mark old alerts of types NOT in today's compute as resolved
      const activeTypes = alerts.map((a) => a.type);
      await Alert.updateMany(
        { hotelId: hotelOId, dedupDate, type: { $nin: activeTypes }, resolvedAt: null },
        { $set: { resolvedAt: new Date() } },
      ).catch(() => {});
    }

    return { date, alerts, checkedAt: new Date().toISOString(), dataSource };
  }
}
