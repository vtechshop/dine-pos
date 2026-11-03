// ─── Super Admin · Delivery (Swiggy / Zomato) — read-only views ───────────────
// Mounted at /api/superadmin/aggregator behind superAdminAuth (see superAdminRoutes).
// Everything here only READS existing records: AggregatorIntegration, Order
// (orderSource swiggy/zomato), WebhookLog, MenuSyncHistory and AuditLog.
// Credentials are never returned. Actions that need live Swiggy/Zomato API
// access (force sync, reset keys, retries) are not offered yet.

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import AggregatorIntegration from '../models/AggregatorIntegration';
import WebhookLog from '../models/WebhookLog';
import MenuSyncHistory from '../models/MenuSyncHistory';
import AuditLog from '../models/AuditLog';
import RemoteConfig from '../models/RemoteConfig';
import { sendError } from '../utils/sendError';
import { todayBusinessDate, startOfBusinessDay, endOfBusinessDay, toBusinessDate } from '../utils/businessDate';

const router = Router();

const PLATFORMS = ['swiggy', 'zomato'] as const;
type Platform = typeof PLATFORMS[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

// ── helpers ──────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isPlatform = (v: string): v is Platform => (PLATFORMS as readonly string[]).includes(v);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const page = (v: unknown) => Math.max(1, parseInt(str(v), 10) || 1);
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** from/to as YYYY-MM-DD (India business days); defaults to the last 7 days. */
function range(req: Request, defaultDays = 7): { from: string; to: string; start: Date; end: Date } {
  const today = todayBusinessDate();
  let to   = DATE_RE.test(str(req.query.to)) ? str(req.query.to) : today;
  let from = DATE_RE.test(str(req.query.from))
    ? str(req.query.from)
    : toBusinessDate(new Date(startOfBusinessDay(to).getTime() - (defaultDays - 1) * 86_400_000 + 12 * 3600_000));
  if (from > to) [from, to] = [to, from];
  return { from, to, start: startOfBusinessDay(from), end: endOfBusinessDay(to) };
}

async function hotelNames(ids: Array<mongoose.Types.ObjectId | string | null | undefined>) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const docs = await Hotel.find({ _id: { $in: uniq } }, { hotelName: 1, city: 1, state: 1 }).lean();
  return new Map(docs.map((h: any) => [String(h._id), h as { hotelName: string; city?: string; state?: string }]));
}

type IntegrationLean = {
  _id: mongoose.Types.ObjectId; hotelId: mongoose.Types.ObjectId; platform: Platform; enabled: boolean;
  storeId?: string; connectionStatus: 'connected' | 'disconnected' | 'error';
  menuSyncStatus?: string; lastSyncAt?: Date | null; lastSyncError?: string | null;
  syncedItemCount?: number; failedItemCount?: number; lastOrderAt?: Date | null;
  lastTestAt?: Date | null; lastTestSuccess?: boolean | null; lastTestMessage?: string;
};

/** The status word the Super Admin pages use for one integration. */
function connStatus(i: IntegrationLean | undefined): 'connected' | 'disconnected' | 'error' | 'pending' | 'disabled' {
  if (!i || !i.enabled) return 'disabled';
  if (i.connectionStatus === 'connected') return 'connected';
  if (i.connectionStatus === 'error') return 'error';
  return i.lastTestAt ? 'disconnected' : 'pending';
}

const INTEGRATION_FIELDS = {
  hotelId: 1, platform: 1, enabled: 1, storeId: 1, connectionStatus: 1, menuSyncStatus: 1,
  lastSyncAt: 1, lastSyncError: 1, syncedItemCount: 1, failedItemCount: 1, lastOrderAt: 1,
  lastTestAt: 1, lastTestSuccess: 1, lastTestMessage: 1,
} as const;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas and quote everything
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ── GET /dashboard ───────────────────────────────────────────────────────────

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const today = todayBusinessDate();
    const start = startOfBusinessDay(today);
    const end   = endOfBusinessDay(today);
    const hourAgo = new Date(Date.now() - 3600_000);

    const [hotelCount, integrations, todayAgg, webhookHour] = await Promise.all([
      Hotel.countDocuments({ 'features.aggregator': true }),
      AggregatorIntegration.find({}, INTEGRATION_FIELDS).lean<IntegrationLean[]>(),
      Order.aggregate([
        { $match: { orderSource: { $in: [...PLATFORMS] }, createdAt: { $gte: start, $lte: end } } },
        { $group: {
          _id: null,
          orders:     { $sum: 1 },
          revenue:    { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, '$grandTotal'] } },
          commission: { $sum: { $ifNull: ['$platformCommission', 0] } },
          refunds:    { $sum: { $ifNull: ['$refundAmount', 0] } },
          cancelled:  { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          accepted:   { $sum: { $cond: [{ $ne: [{ $ifNull: ['$acceptedAt', null] }, null] }, 1, 0] } },
          rejected:   { $sum: { $cond: [{ $ne: [{ $ifNull: ['$rejectedAt', null] }, null] }, 1, 0] } },
          prepMsSum:  { $sum: { $cond: [
            { $and: [{ $ne: [{ $ifNull: ['$acceptedAt', null] }, null] }, { $ne: [{ $ifNull: ['$estimatedPickupTime', null] }, null] }] },
            { $subtract: ['$estimatedPickupTime', '$acceptedAt'] }, 0] } },
          prepCount:  { $sum: { $cond: [
            { $and: [{ $ne: [{ $ifNull: ['$acceptedAt', null] }, null] }, { $ne: [{ $ifNull: ['$estimatedPickupTime', null] }, null] }] }, 1, 0] } },
        } },
      ]),
      WebhookLog.aggregate([
        { $match: { createdAt: { $gte: hourAgo }, platform: { $in: [...PLATFORMS] } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
    ]);

    const byHotel = new Map<string, Set<Platform>>();
    let swiggyConnected = 0, zomatoConnected = 0, disconnected = 0, pendingVerification = 0, failedIntegrations = 0;
    for (const i of integrations) {
      const s = connStatus(i);
      if (s === 'connected') {
        if (i.platform === 'swiggy') swiggyConnected++; else zomatoConnected++;
        const set = byHotel.get(String(i.hotelId)) ?? new Set<Platform>();
        set.add(i.platform); byHotel.set(String(i.hotelId), set);
      }
      if (s === 'disconnected') disconnected++;
      if (s === 'pending') pendingVerification++;
      if (s === 'error') failedIntegrations++;
    }
    const bothConnected = [...byHotel.values()].filter(s => s.size === 2).length;

    const t = todayAgg[0] ?? {};
    const decided = (t.accepted ?? 0) + (t.rejected ?? 0);
    const wh = Object.fromEntries(webhookHour.map((w: any) => [w._id, w.n])) as Record<string, number>;
    const whFailed = (wh.failed ?? 0) + (wh.retrying ?? 0);
    const apiHealth = (p: Platform): 'up' | 'down' | 'degraded' => {
      const mine = integrations.filter(i => i.platform === p && i.enabled);
      if (mine.some(i => i.connectionStatus === 'error')) return 'degraded';
      if (mine.some(i => i.connectionStatus === 'connected')) return 'up';
      return 'down';
    };

    return res.json({
      totalHotels:         hotelCount,
      swiggyConnected, zomatoConnected, bothConnected, disconnected, pendingVerification, failedIntegrations,
      todayOrders:         t.orders ?? 0,
      todayRevenue:        round2(t.revenue ?? 0),
      todayCommission:     round2(t.commission ?? 0),
      todayRefunds:        round2(t.refunds ?? 0),
      todayCancelled:      t.cancelled ?? 0,
      avgAcceptancePct:    decided > 0 ? round2(((t.accepted ?? 0) / decided) * 100) : 0,
      avgPrepMins:         t.prepCount > 0 ? round2(t.prepMsSum / t.prepCount / 60_000) : 0,
      platformHealth: {
        swiggyApi:     apiHealth('swiggy'),
        zomatoApi:     apiHealth('zomato'),
        // This server answered, so it is up; many failures in the last hour = degraded
        webhookServer: whFailed > 0 && whFailed >= (wh.success ?? 0) ? 'degraded' : 'up',
      },
    });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery dashboard', err); }
});

// ── GET /hotels ──────────────────────────────────────────────────────────────

router.get('/hotels', async (req: Request, res: Response) => {
  try {
    const search   = str(req.query.search).trim();
    const status   = str(req.query.status);
    const platform = str(req.query.platform);
    const hotelFilter: Record<string, unknown> = { status: { $nin: ['rejected'] } };
    if (search) {
      const rx = new RegExp(escapeRx(search), 'i');
      hotelFilter.$or = [{ hotelName: rx }, { city: rx }, { state: rx }];
    }
    const hotels = await Hotel.find(hotelFilter, { hotelName: 1, city: 1, state: 1, subscriptionType: 1, status: 1, features: 1 })
      .sort({ hotelName: 1 }).lean();
    const ids = hotels.map((h: any) => h._id);
    const [integrations, counts] = await Promise.all([
      AggregatorIntegration.find({ hotelId: { $in: ids } }, INTEGRATION_FIELDS).lean<IntegrationLean[]>(),
      Order.aggregate([
        { $match: { hotelId: { $in: ids }, orderSource: { $in: [...PLATFORMS] } } },
        { $group: { _id: { h: '$hotelId', p: '$orderSource' }, n: { $sum: 1 } } },
      ]),
    ]);
    const countOf = new Map(counts.map((c: any) => [`${c._id.h}:${c._id.p}`, c.n as number]));

    const side = (h: any, p: Platform) => {
      const i = integrations.find(x => String(x.hotelId) === String(h._id) && x.platform === p);
      if (!i) return null;
      return {
        status:     connStatus(i),
        storeId:    i.storeId ?? '',
        lastSync:   i.lastSyncAt ? new Date(i.lastSyncAt).toISOString() : null,
        lastOrder:  i.lastOrderAt ? new Date(i.lastOrderAt).toISOString() : null,
        lastError:  i.connectionStatus === 'error' ? (i.lastTestMessage || i.lastSyncError || 'Connection error') : (i.lastSyncError || null),
        webhookOk:  !!i.lastOrderAt,
        apiOk:      i.lastTestSuccess === true,
        orderCount: countOf.get(`${h._id}:${p}`) ?? 0,
      };
    };

    let rows = hotels.map((h: any) => ({
      hotelId:        String(h._id),
      hotelName:      h.hotelName,
      city:           h.city ?? '',
      state:          h.state ?? '',
      plan:           h.subscriptionType ?? h.status ?? '',
      featureEnabled: !!h.features?.aggregator,
      swiggy:         side(h, 'swiggy'),
      zomato:         side(h, 'zomato'),
    }));

    if (isPlatform(platform)) rows = rows.filter(r => r[platform] !== null);
    if (status) {
      rows = rows.filter(r => {
        const sides = isPlatform(platform) ? [r[platform]] : [r.swiggy, r.zomato];
        return sides.some(s => (s?.status ?? 'disabled') === status);
      });
    }
    const p = page(req.query.page);
    return res.json({ hotels: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: rows.length });
  } catch (err) { return sendError(res, 500, 'Failed to load hotel integrations', err); }
});

// ── GET /orders ──────────────────────────────────────────────────────────────

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { orderSource: { $in: [...PLATFORMS] } };
    const platform = str(req.query.platform);
    if (isPlatform(platform)) filter.orderSource = platform;
    const date = str(req.query.date);
    if (DATE_RE.test(date)) filter.createdAt = { $gte: startOfBusinessDay(date), $lte: endOfBusinessDay(date) };
    const status = str(req.query.status);
    if (status && /^[a-z_]+$/.test(status)) filter.status = status;
    const hotelId = str(req.query.hotelId);
    if (hotelId && mongoose.isValidObjectId(hotelId)) filter.hotelId = new mongoose.Types.ObjectId(hotelId);

    const p = page(req.query.page);
    const [docs, total] = await Promise.all([
      Order.find(filter, { hotelId: 1, orderNumber: 1, orderSource: 1, status: 1, grandTotal: 1, platformCommission: 1, createdAt: 1 })
        .sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      Order.countDocuments(filter),
    ]);
    const names = await hotelNames(docs.map((o: any) => o.hotelId));
    return res.json({
      total,
      orders: docs.map((o: any) => {
        const h = names.get(String(o.hotelId));
        return {
          _id: String(o._id), hotelId: String(o.hotelId), hotelName: h?.hotelName ?? '—',
          orderNumber: o.orderNumber, platform: o.orderSource, status: o.status,
          grandTotal: round2(o.grandTotal), commission: round2(o.platformCommission ?? 0),
          createdAt: o.createdAt, city: h?.city ?? '', state: h?.state ?? '',
        };
      }),
    });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery orders', err); }
});

// ── GET /webhooks ────────────────────────────────────────────────────────────

router.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const { start, end } = range(req, 2);
    const filter: Record<string, unknown> = { createdAt: { $gte: start, $lte: end } };
    const platform = str(req.query.platform);
    if (isPlatform(platform)) filter.platform = platform;
    const status = str(req.query.status);
    if (['success', 'failed', 'retrying'].includes(status)) filter.status = status;

    const p = page(req.query.page);
    const [docs, total] = await Promise.all([
      WebhookLog.find(filter, { hotelId: 1, platform: 1, event: 1, status: 1, platformOrderId: 1, errorMessage: 1, retryCount: 1, processingTimeMs: 1, rawBody: 1, createdAt: 1 })
        .sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      WebhookLog.countDocuments(filter),
    ]);
    const names = await hotelNames(docs.map((w: any) => w.hotelId));
    return res.json({
      total,
      logs: docs.map((w: any) => ({
        _id: String(w._id), hotelId: w.hotelId ? String(w.hotelId) : '',
        hotelName: w.hotelId ? (names.get(String(w.hotelId))?.hotelName ?? '—') : 'Unknown hotel',
        platform: w.platform, event: w.event, status: w.status,
        platformOrderId: w.platformOrderId ?? '', errorMessage: w.errorMessage ?? null,
        retryCount: w.retryCount ?? 0, latencyMs: w.processingTimeMs ?? 0,
        payloadBytes: typeof w.rawBody === 'string' ? Buffer.byteLength(w.rawBody) : 0,   // size only, never the body
        createdAt: w.createdAt,
      })),
    });
  } catch (err) { return sendError(res, 500, 'Failed to load webhook log', err); }
});

// ── GET /sync-status ─────────────────────────────────────────────────────────

router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { enabled: true };
    const platform = str(req.query.platform);
    if (isPlatform(platform)) filter.platform = platform;
    const integrations = await AggregatorIntegration.find(filter, INTEGRATION_FIELDS).lean<IntegrationLean[]>();
    const names = await hotelNames(integrations.map(i => i.hotelId));
    const norm = (s?: string): 'idle' | 'syncing' | 'success' | 'failed' =>
      s === 'syncing' ? 'syncing' : s === 'success' ? 'success' : (s === 'failed' || s === 'partial') ? 'failed' : 'idle';
    let syncs = integrations.map(i => ({
      hotelId: String(i.hotelId), hotelName: names.get(String(i.hotelId))?.hotelName ?? '—',
      platform: i.platform, syncedProducts: i.syncedItemCount ?? 0, syncedCategories: 0,
      failedProducts: i.failedItemCount ?? 0, retryPending: 0,
      lastSync: i.lastSyncAt ? new Date(i.lastSyncAt).toISOString() : null,
      status: norm(i.menuSyncStatus),
    }));
    const status = str(req.query.status);
    if (status) syncs = syncs.filter(s => s.status === status);
    return res.json({ syncs, total: syncs.length });
  } catch (err) { return sendError(res, 500, 'Failed to load menu sync status', err); }
});

// ── Analytics (settlement/payouts are left out: Swiggy/Zomato settle with each hotel directly) ──────────────────────────────

async function ordersInRange(start: Date, end: Date) {
  return Order.find(
    { orderSource: { $in: [...PLATFORMS] }, createdAt: { $gte: start, $lte: end } },
    { hotelId: 1, orderSource: 1, status: 1, grandTotal: 1, platformCommission: 1, refundAmount: 1,
      acceptedAt: 1, rejectedAt: 1, estimatedPickupTime: 1, createdAt: 1, 'items.productName': 1, 'items.quantity': 1, 'items.total': 1 },
  ).lean();
}

router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const { from, to, start, end } = range(req, 7);
    const orders = await ordersInRange(start, end) as any[];
    const names  = await hotelNames(orders.map(o => o.hotelId));

    const days: string[] = [];
    for (let d = from; d <= to; d = toBusinessDate(new Date(startOfBusinessDay(d).getTime() + 36 * 3600_000))) {
      days.push(d);
      if (days.length > 400) break;
    }
    const dayOf = (o: any) => toBusinessDate(new Date(o.createdAt));
    const live  = orders.filter(o => o.status !== 'cancelled');
    const revenueByDay = days.map(date => ({
      date,
      swiggy: round2(live.filter(o => o.orderSource === 'swiggy' && dayOf(o) === date).reduce((s, o) => s + (o.grandTotal || 0), 0)),
      zomato: round2(live.filter(o => o.orderSource === 'zomato' && dayOf(o) === date).reduce((s, o) => s + (o.grandTotal || 0), 0)),
    }));
    const orderGrowth = days.map(date => ({ date, count: orders.filter(o => dayOf(o) === date).length }));

    const accepted  = orders.filter(o => o.acceptedAt).length;
    const rejected  = orders.filter(o => o.rejectedAt).length;
    const cancelled = orders.filter(o => o.status === 'cancelled').length;
    const refunded  = orders.filter(o => (o.refundAmount || 0) > 0).length;
    const prep = orders.filter(o => o.acceptedAt && o.estimatedPickupTime)
      .map(o => (new Date(o.estimatedPickupTime).getTime() - new Date(o.acceptedAt).getTime()) / 60_000);
    const pct = (n: number, d: number) => (d > 0 ? round2((n / d) * 100) : 0);

    const tally = <K extends string>(keyOf: (o: any) => K) => {
      const m = new Map<K, { orders: number; revenue: number }>();
      for (const o of live) { const k = keyOf(o); const c = m.get(k) ?? { orders: 0, revenue: 0 }; c.orders++; c.revenue += o.grandTotal || 0; m.set(k, c); }
      return m;
    };
    const topHotels = [...tally(o => String(o.hotelId)).entries()]
      .map(([hotelId, v]) => ({ hotelId, hotelName: names.get(hotelId)?.hotelName ?? '—', orders: v.orders, revenue: round2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const topCities = [...tally(o => names.get(String(o.hotelId))?.city || 'Unknown').entries()]
      .map(([city, v]) => ({ city, orders: v.orders, revenue: round2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const prod = new Map<string, { quantity: number; revenue: number }>();
    for (const o of live) for (const it of o.items ?? []) {
      const c = prod.get(it.productName) ?? { quantity: 0, revenue: 0 };
      c.quantity += it.quantity || 0; c.revenue += it.total || 0; prod.set(it.productName, c);
    }
    const topProducts = [...prod.entries()].map(([name, v]) => ({ name, quantity: v.quantity, revenue: round2(v.revenue) }))
      .sort((a, b) => b.quantity - a.quantity).slice(0, 10);

    return res.json({
      revenueByDay, orderGrowth,
      acceptancePct:   pct(accepted, accepted + rejected),
      cancellationPct: pct(cancelled, orders.length),
      refundPct:       pct(refunded, orders.length),
      avgPrepMins:     prep.length ? round2(prep.reduce((s, x) => s + x, 0) / prep.length) : 0,
      topHotels, topCities, topProducts,
    });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery analytics', err); }
});

// ── GET /alerts — problems worth a look, worked out from current records ────

router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [integrations, failedHooks] = await Promise.all([
      AggregatorIntegration.find({ enabled: true }, { ...INTEGRATION_FIELDS, updatedAt: 1 }).lean<(IntegrationLean & { updatedAt?: Date })[]>(),
      WebhookLog.aggregate([
        { $match: { createdAt: { $gte: dayAgo }, status: { $in: ['failed', 'retrying'] } } },
        { $group: { _id: { h: '$hotelId', p: '$platform' }, n: { $sum: 1 }, last: { $max: '$createdAt' }, msg: { $last: '$errorMessage' } } },
      ]),
    ]);
    const names = await hotelNames([...integrations.map(i => i.hotelId), ...failedHooks.map((f: any) => f._id.h)]);
    const label = (p: string) => (p === 'swiggy' ? 'Swiggy' : p === 'zomato' ? 'Zomato' : p);
    const alerts: { id: string; type: string; severity: 'critical' | 'warning' | 'info'; hotelId?: string; hotelName?: string; message: string; createdAt: string; resolved: boolean }[] = [];

    for (const i of integrations) {
      const hotelName = names.get(String(i.hotelId))?.hotelName;
      const when = new Date(i.lastTestAt ?? i.updatedAt ?? Date.now()).toISOString();
      const s = connStatus(i);
      if (s === 'error') alerts.push({ id: `conn-${i._id}`, type: 'hotel_disconnected', severity: 'critical', hotelId: String(i.hotelId), hotelName,
        message: `${label(i.platform)} connection error — ${i.lastTestMessage || 'check the store ID and keys'}`, createdAt: when, resolved: false });
      else if (s === 'disconnected' || s === 'pending') alerts.push({ id: `conn-${i._id}`, type: 'not_connected', severity: 'warning', hotelId: String(i.hotelId), hotelName,
        message: `${label(i.platform)} is switched on but not connected${s === 'pending' ? ' (never tested)' : ''}`, createdAt: when, resolved: false });
      if (i.menuSyncStatus === 'failed' || i.menuSyncStatus === 'partial') alerts.push({ id: `sync-${i._id}`, type: 'menu_sync_failed', severity: 'warning', hotelId: String(i.hotelId), hotelName,
        message: `${label(i.platform)} menu sync ${i.menuSyncStatus === 'partial' ? 'partly failed' : 'failed'}${i.lastSyncError ? ` — ${i.lastSyncError}` : ''}`,
        createdAt: new Date(i.lastSyncAt ?? i.updatedAt ?? Date.now()).toISOString(), resolved: false });
    }
    for (const f of failedHooks as any[]) {
      alerts.push({ id: `hook-${f._id.h ?? 'none'}-${f._id.p}`, type: 'webhook_failed', severity: f.n >= 5 ? 'critical' : 'warning',
        hotelId: f._id.h ? String(f._id.h) : undefined, hotelName: f._id.h ? names.get(String(f._id.h))?.hotelName : 'Unknown hotel',
        message: `${f.n} ${label(f._id.p)} webhook${f.n === 1 ? '' : 's'} failed in the last 24 h${f.msg ? ` — ${f.msg}` : ''}`,
        createdAt: new Date(f.last).toISOString(), resolved: false });
    }
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdAt.localeCompare(a.createdAt));
    return res.json({ alerts });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery alerts', err); }
});

// ── GET /audit — Swiggy/Zomato actions across hotels ─────────────────────────

const AUDIT_LABEL: Record<string, string> = {
  'aggregator.integration.update':     'Integration settings changed',
  'aggregator.integration.disconnect': 'Integration disconnected',
  'aggregator.integration.test':       'Connection tested',
  'aggregator.menu.sync':              'Menu synced',
  'aggregator.order.accept':           'Order accepted',
  'aggregator.order.reject':           'Order rejected',
  'aggregator.order.ready':            'Order marked ready',
  'aggregator.order.dispatch':         'Order dispatched',
  'aggregator.webhook.retry':          'Webhook retried',
  'aggregator.auto_sync.config':       'Auto-sync settings changed',
  'aggregator.item.availability':      'Item availability changed',
  'aggregator.item.bulk_availability': 'Bulk item availability changed',
};

router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { start, end } = range(req, 30);
    const filter: Record<string, unknown> = { action: /^aggregator\./, createdAt: { $gte: start, $lte: end } };
    const type = str(req.query.type);
    if (type && /^[a-z_.]+$/.test(type)) filter.action = type.startsWith('aggregator.') ? type : `aggregator.${type}`;
    const docs = await AuditLog.find(filter, { hotelId: 1, actorId: 1, actorRole: 1, action: 1, metadata: 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(200).lean();
    const names = await hotelNames(docs.map((d: any) => (mongoose.isValidObjectId(String(d.hotelId)) ? d.hotelId : null)));
    return res.json({
      entries: docs.map((d: any) => {
        const m = (d.metadata ?? {}) as Record<string, unknown>;
        const bits = [m.platform, m.reason, m.syncedCount !== undefined ? `${m.syncedCount} synced` : null,
          m.failedCount ? `${m.failedCount} failed` : null, m.success !== undefined ? (m.success ? 'ok' : 'failed') : null]
          .filter(Boolean).map(String);
        return {
          id: String(d._id), action: AUDIT_LABEL[d.action] ?? d.action,
          hotelId: String(d.hotelId ?? ''), hotelName: names.get(String(d.hotelId))?.hotelName,
          detail: bits.join(' · '), actorId: [d.actorRole, d.actorId].filter(Boolean).join(': '), createdAt: d.createdAt,
        };
      }),
    });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery audit log', err); }
});

// ── GET /settings — the server's current values (read-only) ──────────────────

router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const rc = await RemoteConfig.findOne({}, { maintenanceMode: 1 }).lean<{ maintenanceMode?: boolean } | null>();
    return res.json({
      webhookTimeoutMs: 12_000,  // outgoing Swiggy/Zomato API calls (connector timeout)
      retryCount:       0,       // failed webhooks are retried by hand from the hotel's Online Orders
      retryDelayMs:     0,
      syncIntervalMins: 60,      // default auto menu-sync interval per hotel
      queueSizeLimit:   0,
      swiggyRateLimit:  60,      // webhook requests per minute per sender
      zomatoRateLimit:  60,
      maintenanceMode:  !!rc?.maintenanceMode,
    });
  } catch (err) { return sendError(res, 500, 'Failed to load delivery settings', err); }
});

// ── GET /reports/generate?type=&from=&to=&format=csv ─────────────────────────

router.get('/reports/generate', async (req: Request, res: Response) => {
  try {
    const type = str(req.query.type);
    const { from, to, start, end } = range(req, 7);
    let header: string[] = [];
    let rows: unknown[][] = [];

    if (['revenue', 'commission', 'cancellation', 'refund', 'aggregator'].includes(type)) {
      const filter: Record<string, unknown> = { orderSource: { $in: [...PLATFORMS] }, createdAt: { $gte: start, $lte: end } };
      if (type === 'cancellation') filter.status = 'cancelled';
      if (type === 'refund') filter.refundAmount = { $gt: 0 };
      const orders = await Order.find(filter, {
        hotelId: 1, orderNumber: 1, platformOrderId: 1, orderSource: 1, status: 1, grandTotal: 1, platformCommission: 1,
        refundAmount: 1, refundReason: 1, rejectionReason: 1, createdAt: 1,
      }).sort({ createdAt: 1 }).lean();
      const names = await hotelNames(orders.map((o: any) => o.hotelId));
      const hn = (o: any) => names.get(String(o.hotelId))?.hotelName ?? '';

      if (type === 'revenue') {
        // One row per hotel per platform
        const m = new Map<string, { hotel: string; platform: string; orders: number; revenue: number; commission: number; refunds: number }>();
        for (const o of orders as any[]) {
          const k = `${o.hotelId}:${o.orderSource}`;
          const c = m.get(k) ?? { hotel: hn(o), platform: o.orderSource, orders: 0, revenue: 0, commission: 0, refunds: 0 };
          if (o.status !== 'cancelled') { c.orders++; c.revenue += o.grandTotal || 0; c.commission += o.platformCommission || 0; }
          c.refunds += o.refundAmount || 0;
          m.set(k, c);
        }
        header = ['Hotel', 'Platform', 'Orders', 'Revenue', 'Commission', 'Refunds', 'Net payout'];
        rows = [...m.values()].map(c => [c.hotel, c.platform, c.orders, round2(c.revenue), round2(c.commission), round2(c.refunds), round2(c.revenue - c.commission - c.refunds)]);
      } else {
        header = ['Date', 'Hotel', 'Platform', 'Order #', 'Platform order ID', 'Status', 'Total', 'Commission', 'Refund', 'Reason'];
        rows = (orders as any[]).map(o => [o.createdAt, hn(o), o.orderSource, o.orderNumber, o.platformOrderId ?? '', o.status,
          round2(o.grandTotal), round2(o.platformCommission ?? 0), round2(o.refundAmount ?? 0), o.refundReason || o.rejectionReason || '']);
      }
    } else if (type === 'menu-sync') {
      const docs = await MenuSyncHistory.find({ startedAt: { $gte: start, $lte: end } },
        { hotelId: 1, platform: 1, syncType: 1, triggeredBy: 1, status: 1, startedAt: 1, durationMs: 1, totalItems: 1, syncedItems: 1, failedItems: 1 })
        .sort({ startedAt: 1 }).lean();
      const names = await hotelNames(docs.map((d: any) => d.hotelId));
      header = ['Started', 'Hotel', 'Platform', 'Type', 'Triggered by', 'Status', 'Items', 'Synced', 'Failed', 'Duration (ms)'];
      rows = (docs as any[]).map(d => [d.startedAt, names.get(String(d.hotelId))?.hotelName ?? '', d.platform, d.syncType, d.triggeredBy, d.status, d.totalItems, d.syncedItems, d.failedItems, d.durationMs ?? '']);
    } else if (type === 'webhook') {
      const docs = await WebhookLog.find({ createdAt: { $gte: start, $lte: end } },
        { hotelId: 1, platform: 1, event: 1, status: 1, platformOrderId: 1, errorMessage: 1, retryCount: 1, processingTimeMs: 1, createdAt: 1 })
        .sort({ createdAt: 1 }).limit(20_000).lean();
      const names = await hotelNames(docs.map((d: any) => d.hotelId));
      header = ['Received', 'Hotel', 'Platform', 'Event', 'Status', 'Platform order ID', 'Error', 'Retries', 'Processing (ms)'];
      rows = (docs as any[]).map(d => [d.createdAt, d.hotelId ? (names.get(String(d.hotelId))?.hotelName ?? '') : '', d.platform, d.event, d.status, d.platformOrderId ?? '', d.errorMessage ?? '', d.retryCount ?? 0, d.processingTimeMs ?? '']);
    } else {
      return res.status(400).json({ message: 'Unknown report type' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aggregator-${type}-${from}-to-${to}.csv"`);
    return res.send('﻿' + toCsv(header, rows));
  } catch (err) { return sendError(res, 500, 'Failed to build report', err); }
});

export default router;
