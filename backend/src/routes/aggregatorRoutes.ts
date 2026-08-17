import { Router, Request, Response } from 'express';
import { timingSafeEqual, createHmac } from 'crypto';
import { authMiddleware, requireAdmin, requireCashierOrAdmin, type AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import AggregatorIntegration, { type IAggregatorIntegration } from '../models/AggregatorIntegration';
import MenuSyncHistory from '../models/MenuSyncHistory';
import WebhookLog from '../models/WebhookLog';
import Order from '../models/Order';
import Product from '../models/Product';
import Category from '../models/Category';
import Hotel from '../models/Hotel';
import DailyCounter from '../models/DailyCounter';
import { io } from '../server';
import { AggregatorService } from '../services/aggregator/AggregatorService';
import type { AggregatorPlatform } from '../models/AggregatorIntegration';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import { makeRateLimiter } from '../utils/rateLimiter';
import { encrypt, decrypt } from '../utils/encryption';
import { getMessagingProvider } from '../services/messagingProvider';

const webhookRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60 });

const router = Router();

// ── Legacy: simple shared-secret guard ────────────────────────────────────────
const WEBHOOK_SECRET = process.env.AGGREGATOR_SECRET;
if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'agg-secret-changeme') {
  throw new Error(
    'FATAL: AGGREGATOR_SECRET is not set or is using the default value. ' +
    'Set a strong random secret in .env before starting the server.',
  );
}

const safeEqualSecret = (a: string, b: string): boolean => {
  try {
    return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
};

// Strip encrypted fields — return boolean flags so secrets never reach the frontend.
function safeIntegration(doc: IAggregatorIntegration, extra: Record<string, unknown> = {}) {
  const obj = doc.toObject() as Record<string, unknown>;
  delete obj.apiKeyEnc;
  delete obj.apiSecretEnc;
  delete obj.webhookSecretEnc;
  return {
    ...obj,
    hasApiKey:        !!doc.apiKeyEnc,
    hasApiSecret:     !!doc.apiSecretEnc,
    hasWebhookSecret: !!doc.webhookSecretEnc,
    ...extra,
  };
}

// Fire-and-forget MSG91 delivery notification — never throws.
async function notifyDelivery(
  hotelId: string,
  event:   'accepted' | 'ready' | 'completed',
  order:   { customerPhone?: string; orderNumber: string; orderSource: string },
): Promise<void> {
  if (!order.customerPhone) return;
  try {
    const provider = await getMessagingProvider(hotelId, 'sms');
    const messages: Record<string, string> = {
      accepted:  `Your ${order.orderSource} order #${order.orderNumber} has been accepted and is being prepared.`,
      ready:     `Your ${order.orderSource} order #${order.orderNumber} is ready for pickup!`,
      completed: `Your ${order.orderSource} order #${order.orderNumber} has been dispatched. Enjoy your meal!`,
    };
    await provider.sendMessages(order.orderNumber, 'sms', [{ phone: order.customerPhone, message: messages[event] }]);
  } catch {
    // Non-fatal: messaging failures must not affect order flow
  }
}

// H-10: HMAC-SHA256 verification for legacy webhook endpoints.
// Caller must send header: x-webhook-hmac: sha256=<hex-digest-of-body>
// Verification is timing-safe (timingSafeEqual prevents timing oracle).
const verifyLegacyHmac = (rawBody: string, header: string | undefined): boolean => {
  if (!WEBHOOK_SECRET || !header) return false;
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  const received = header.slice(prefix.length);
  try {
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch { return false; }
};

type OrderSourceType = 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr';

const SOURCE_MAP: Record<string, OrderSourceType> = {
  swiggy:   'swiggy',
  zomato:   'zomato',
  qr:       'qr',
  takeaway: 'takeaway',
};

// Atomic counter — same pattern as orderRoutes.ts, AGG prefix for aggregator orders
const generateOrderNumber = async (hotelId: string): Promise<string> => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key     = `AGG-${dateStr}-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  return `AGG-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;
};

// Shared order creation logic used by legacy webhooks
const createAggregatorOrder = async (
  hotelId:      string,
  source:       OrderSourceType,
  items:        any[],
  total:        number,
  customerName: string,
  address:      string,
  notes:        string,
) => {
  const hotel = await Hotel.findById(hotelId).select('status features hotelName');
  if (!hotel || hotel.status !== 'active') {
    throw Object.assign(new Error('Hotel not found or inactive'), { statusCode: 404 });
  }
  if (!(hotel as any).features?.aggregator) {
    throw Object.assign(new Error('Aggregator feature is not enabled for this hotel'), { statusCode: 403 });
  }

  const normalizedItems = items.map((item: any) => ({
    product:     item.productId || null,
    productName: item.name || item.productName || 'Unknown',
    quantity:    item.quantity || 1,
    price:       item.price || 0,
    taxPercent:  item.taxPercent || 0,
    taxAmount:   item.taxAmount || 0,
    total:       (item.price || 0) * (item.quantity || 1),
  }));

  const subtotal    = normalizedItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  const taxTotal    = normalizedItems.reduce((s: number, i: any) => s + i.taxAmount, 0);
  const orderNumber = await generateOrderNumber(hotelId);
  const srcLabel    = source.charAt(0).toUpperCase() + source.slice(1);

  const order = new Order({
    hotelId,
    orderNumber,
    items:          normalizedItems,
    subtotal,
    taxTotal,
    discountAmount: 0,
    grandTotal:     total || subtotal,
    paymentMethod:  'upi',
    status:         'pending',
    orderSource:    source,
    isParcel:       true,
    customerName:   customerName || 'Online Customer',
    tableNumber:    srcLabel,
    notes:          `${srcLabel} ORDER${address ? ' — ' + address : ''}${notes ? ' | ' + notes : ''}`.trim(),
  });

  await order.save();

  io.to(`hotel_${hotelId}`).emit('new_order', {
    _id:          order._id,
    orderNumber:  order.orderNumber,
    tableNumber:  srcLabel,
    customerName: order.customerName,
    grandTotal:   order.grandTotal,
    itemCount:    order.items.length,
    orderSource:  source,
  });

  return order;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CORE WEBHOOK PROCESSING — shared by new /webhook/* endpoints
// ═══════════════════════════════════════════════════════════════════════════════

async function processAggregatorWebhook(
  platform: AggregatorPlatform,
  rawBody:  string,
  headers:  Record<string, string>,
): Promise<{ hotelId?: string; orderId?: string; platformOrderId?: string; event?: string; error?: string }> {
  // 1. Partially parse to get storeId (before full parse, for logging)
  let storeId = '';
  try {
    const partial = JSON.parse(rawBody);
    storeId = String(
      partial.restaurant_id || partial.res_id || partial.store_id || partial.hotelId || '',
    );
  } catch { /* ignore parse errors here — handled below */ }

  // 2. Find integration by storeId (or by hotelId for legacy)
  let integration = storeId
    ? await AggregatorService.getIntegrationByStoreId(platform, storeId)
    : null;

  // Legacy path: body may contain hotelId directly
  const bodyObj = (() => { try { return JSON.parse(rawBody); } catch { return {}; } })();
  let hotelId = integration?.hotelId?.toString() || bodyObj.hotelId || '';

  // 3. Verify signature
  if (integration) {
    const connector      = AggregatorService.getConnector(platform);
    const webhookSecret  = integration.webhookSecretEnc ? decrypt(integration.webhookSecretEnc) : '';
    const valid          = connector.verifyWebhookSignature(rawBody, headers, webhookSecret);
    if (!valid) return { error: 'Invalid webhook signature' };
  } else {
    // No matching integration — always require the shared secret, even when hotelId
    // is present in the body. Without this gate, an attacker who knows a hotel's
    // MongoDB ObjectId can inject orders by sending a body with hotelId set.
    const sharedSecret = process.env.AGGREGATOR_SECRET;
    const incoming     = headers['x-webhook-secret'] || '';
    try {
      const { timingSafeEqual: tse } = await import('crypto');
      if (
        !sharedSecret ||
        !incoming ||
        incoming.length !== sharedSecret.length ||
        !tse(Buffer.from(incoming), Buffer.from(sharedSecret))
      ) {
        return { error: 'No matching integration and invalid fallback secret' };
      }
    } catch { return { error: 'Signature verification error' }; }
  }

  // 4. Parse order
  const connector = AggregatorService.getConnector(platform);
  let parsed;
  try {
    parsed = connector.parseIncomingOrder(rawBody);
  } catch (err) {
    return { error: `Failed to parse order payload: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!hotelId && integration) hotelId = integration.hotelId.toString();
  if (!hotelId) return { error: 'Cannot identify hotel for this webhook' };

  // 5. Check hotel status + feature flag
  const hotel = await Hotel.findById(hotelId).select('status features');
  if (!hotel || hotel.status !== 'active') return { error: 'Hotel not found or inactive' };
  if (!(hotel as any).features?.aggregator) return { error: 'aggregator feature not enabled' };

  // 6. Route by event type — handle cancellations and updates before creating new orders
  if (parsed.event === 'order_cancelled') {
    if (parsed.platformOrderId) {
      const existing = await Order.findOne({ hotelId, platformOrderId: parsed.platformOrderId });
      if (existing && !['cancelled', 'completed'].includes(existing.status)) {
        await existing.updateOne({
          status:          'cancelled',
          rejectedAt:      new Date(),
          rejectionReason: 'Cancelled by platform',
        });
        io.to(`hotel_${hotelId}`).emit('order_status_change', {
          _id:    existing._id,
          status: 'cancelled',
          platform,
          reason: 'Cancelled by platform',
        });
      }
      return {
        hotelId,
        event:           parsed.event,
        orderId:         existing?._id.toString(),
        platformOrderId: parsed.platformOrderId,
      };
    }
    return { hotelId, event: parsed.event, platformOrderId: parsed.platformOrderId };
  }

  if (parsed.event === 'order_update') {
    // If order exists, acknowledge; if not, fall through to create (out-of-order webhook)
    if (parsed.platformOrderId) {
      const existing = await Order.findOne({ hotelId, platformOrderId: parsed.platformOrderId });
      if (existing) {
        return { hotelId, event: parsed.event, orderId: existing._id.toString(), platformOrderId: parsed.platformOrderId };
      }
    }
  }

  // new_order (or unknown event): standard idempotency check, then create
  if (parsed.platformOrderId) {
    const existing = await Order.findOne({ hotelId, platformOrderId: parsed.platformOrderId });
    if (existing) {
      return { hotelId, event: parsed.event, orderId: existing._id.toString(), platformOrderId: parsed.platformOrderId };
    }
  }

  // 7. Generate order number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key     = `AGG-${dateStr}-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  const orderNumber = `AGG-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;

  // 8. Build order items
  const items = parsed.items.map(i => ({
    productName: i.productName,
    quantity:    i.quantity,
    price:       i.price,
    taxPercent:  i.taxPercent ?? 0,
    taxAmount:   (i.price * i.quantity * (i.taxPercent ?? 0)) / 100,
    total:       i.price * i.quantity,
  }));
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);

  // 9. Create order
  const order = new Order({
    hotelId,
    orderNumber,
    items,
    subtotal,
    taxTotal:            parsed.taxTotal,
    grandTotal:          parsed.grandTotal || subtotal + parsed.deliveryFee,
    paymentMethod:       'upi',
    status:              'pending',
    orderSource:         platform,
    isParcel:            true,
    customerName:        parsed.customerName,
    customerPhone:       parsed.customerPhone,
    tableNumber:         platform.charAt(0).toUpperCase() + platform.slice(1),
    notes:               parsed.notes || '',
    platformOrderId:     parsed.platformOrderId,
    deliveryAddress:     parsed.deliveryAddress,
    deliveryFee:         parsed.deliveryFee,
    estimatedPickupTime: parsed.estimatedPickupTime ? new Date(parsed.estimatedPickupTime) : null,
  });
  await order.save();

  // 10. Update lastOrderAt on integration
  if (integration) {
    await AggregatorIntegration.findByIdAndUpdate(integration._id, {
      lastOrderAt:      new Date(),
      connectionStatus: 'connected',
    });
  }

  // 11. Auto-accept if configured
  if (integration?.autoAccept && parsed.platformOrderId) {
    try {
      await AggregatorService.acceptOrder(hotelId, platform, parsed.platformOrderId);
      await Order.findByIdAndUpdate(order._id, { acceptedAt: new Date(), status: 'preparing' });
    } catch (err) {
      console.error('[AggregatorService] auto-accept failed:', err);
    }
  }

  // 12. Emit socket events
  io.to(`hotel_${hotelId}`).emit('new_order', {
    _id:             order._id,
    orderNumber:     order.orderNumber,
    tableNumber:     order.tableNumber,
    customerName:    order.customerName,
    grandTotal:      order.grandTotal,
    itemCount:       order.items.length,
    orderSource:     platform,
    deliveryAddress: parsed.deliveryAddress,
    platformOrderId: parsed.platformOrderId,
  });
  io.to(`hotel_${hotelId}`).emit('new_delivery_order', {
    _id:                 order._id,
    orderNumber:         order.orderNumber,
    orderSource:         platform,
    platformOrderId:     parsed.platformOrderId,
    status:              integration?.autoAccept ? 'preparing' : 'pending',
    customerName:        order.customerName,
    customerPhone:       parsed.customerPhone,
    deliveryAddress:     order.deliveryAddress ?? '',
    grandTotal:          order.grandTotal,
    subtotal:            order.subtotal ?? 0,
    taxTotal:            order.taxTotal ?? 0,
    discountAmount:      0,
    platformCommission:  0,
    deliveryFee:         order.deliveryFee ?? 0,
    deliveryPartnerName: null,
    items:               (order.items as any[]).map(i => ({
      productName: i.productName,
      quantity:    i.quantity,
      price:       i.price,
      total:       i.total,
    })),
    notes:               order.notes ?? '',
    acceptedAt:          integration?.autoAccept ? new Date().toISOString() : null,
    rejectedAt:          null,
    rejectionReason:     '',
    estimatedPickupTime: order.estimatedPickupTime
      ? (order.estimatedPickupTime as Date).toISOString()
      : null,
    createdAt:           order.createdAt?.toISOString() ?? new Date().toISOString(),
  });

  return { hotelId, event: parsed.event, orderId: order._id.toString(), platformOrderId: parsed.platformOrderId };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS — keep existing URLs working
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/aggregator/order — generic webhook (old path)
router.post('/order', async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body);
  const hmacHeader = req.headers['x-webhook-hmac'] as string | undefined;
  if (!verifyLegacyHmac(rawBody, hmacHeader)) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook signature' });
  }

  try {
    const { hotelId, source = 'takeaway', items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });

    const orderSource: OrderSourceType = SOURCE_MAP[source.toLowerCase()] || 'takeaway';
    const order = await createAggregatorOrder(hotelId, orderSource, items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber });
  } catch (error: any) {
    console.error('Aggregator webhook error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

// POST /api/aggregator/swiggy — old Swiggy path
router.post('/swiggy', async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body);
  const hmacHeader = req.headers['x-webhook-hmac'] as string | undefined;
  if (!verifyLegacyHmac(rawBody, hmacHeader)) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook signature' });
  }
  try {
    const { hotelId, items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });
    const order = await createAggregatorOrder(hotelId, 'swiggy', items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber, source: 'swiggy' });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

// POST /api/aggregator/zomato — old Zomato path
router.post('/zomato', async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body);
  const hmacHeader = req.headers['x-webhook-hmac'] as string | undefined;
  if (!verifyLegacyHmac(rawBody, hmacHeader)) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook signature' });
  }
  try {
    const { hotelId, items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });
    const order = await createAggregatorOrder(hotelId, 'zomato', items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber, source: 'zomato' });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW WEBHOOK ENDPOINTS — public, no auth, per-hotel HMAC
// (Swiggy/Zomato call these URLs directly)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/aggregator/webhook/swiggy
router.post('/webhook/swiggy', webhookRateLimiter, async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string'
    ? (req as any).rawBody
    : JSON.stringify(req.body);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
  }

  const logEntry = new WebhookLog({
    platform:        'swiggy',
    event:           'new_order',
    rawBody:         rawBody.slice(0, 20000),
    headers:         { 'x-swiggy-signature': headers['x-swiggy-signature'] || '' },
    status:          'retrying',
    platformOrderId: '',
  });

  const startTime = Date.now();

  try {
    const result = await processAggregatorWebhook('swiggy', rawBody, headers);
    const processingTimeMs = Date.now() - startTime;

    if (result.error) {
      logEntry.status          = 'failed';
      logEntry.errorMessage    = result.error;
      logEntry.processingTimeMs = processingTimeMs;
      await logEntry.save().catch(() => {});
      return res.status(200).json({ success: false, error: result.error });
    }

    logEntry.status           = 'success';
    logEntry.event            = result.event || 'new_order';
    logEntry.orderId          = result.orderId ? (result.orderId as any) : null;
    logEntry.platformOrderId  = result.platformOrderId || '';
    logEntry.hotelId          = result.hotelId ? (result.hotelId as any) : null;
    logEntry.processingTimeMs = processingTimeMs;
    await logEntry.save().catch(() => {});

    return res.status(200).json({ success: true, orderId: result.orderId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aggregatorRoutes] /webhook/swiggy unhandled error:', err);
    logEntry.status           = 'failed';
    logEntry.errorMessage     = msg;
    logEntry.processingTimeMs = Date.now() - startTime;
    await logEntry.save().catch(() => {});
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/aggregator/webhook/zomato
router.post('/webhook/zomato', webhookRateLimiter, async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string'
    ? (req as any).rawBody
    : JSON.stringify(req.body);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
  }

  const logEntry = new WebhookLog({
    platform:        'zomato',
    event:           'new_order',
    rawBody:         rawBody.slice(0, 20000),
    headers:         { 'x-zomato-signature': headers['x-zomato-signature'] || '' },
    status:          'retrying',
    platformOrderId: '',
  });

  const startTime = Date.now();

  try {
    const result = await processAggregatorWebhook('zomato', rawBody, headers);
    const processingTimeMs = Date.now() - startTime;

    if (result.error) {
      logEntry.status           = 'failed';
      logEntry.errorMessage     = result.error;
      logEntry.processingTimeMs = processingTimeMs;
      await logEntry.save().catch(() => {});
      return res.status(200).json({ success: false, error: result.error });
    }

    logEntry.status           = 'success';
    logEntry.event            = result.event || 'new_order';
    logEntry.orderId          = result.orderId ? (result.orderId as any) : null;
    logEntry.platformOrderId  = result.platformOrderId || '';
    logEntry.hotelId          = result.hotelId ? (result.hotelId as any) : null;
    logEntry.processingTimeMs = processingTimeMs;
    await logEntry.save().catch(() => {});

    return res.status(200).json({ success: true, orderId: result.orderId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aggregatorRoutes] /webhook/zomato unhandled error:', err);
    logEntry.status           = 'failed';
    logEntry.errorMessage     = msg;
    logEntry.processingTimeMs = Date.now() - startTime;
    await logEntry.save().catch(() => {});
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION MANAGEMENT — protected: authMiddleware + requireAdmin
// ═══════════════════════════════════════════════════════════════════════════════

const PLATFORMS: AggregatorPlatform[] = ['swiggy', 'zomato'];

// GET /api/aggregator/integrations — list both integrations (creates defaults if missing)
router.get(
  '/integrations',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const today   = new Date(); today.setHours(0, 0, 0, 0);

      const integrations = await Promise.all(
        PLATFORMS.map(async platform => {
          let integration = await AggregatorIntegration.findOne({ hotelId, platform });
          if (!integration) integration = await AggregatorIntegration.create({ hotelId, platform });
          const todayOrderCount = await Order.countDocuments({
            hotelId, orderSource: platform, createdAt: { $gte: today },
          });
          return safeIntegration(integration, { todayOrderCount });
        }),
      );
      res.json({ integrations });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// GET /api/aggregator/integrations/:platform
router.get(
  '/integrations/:platform',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
      }
      const hotelId = req.hotelId!;
      let integration = await AggregatorIntegration.findOne({ hotelId, platform });
      if (!integration) integration = await AggregatorIntegration.create({ hotelId, platform });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayOrderCount = await Order.countDocuments({ hotelId, orderSource: platform, createdAt: { $gte: today } });
      res.json({ integration: safeIntegration(integration, { todayOrderCount }) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// PUT /api/aggregator/integrations/:platform — create/update (upsert)
router.put(
  '/integrations/:platform',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
      }
      const hotelId = req.hotelId!;

      // Only allow known fields — secrets are write-only and encrypted before storage
      const { enabled, storeId, apiKey, apiSecret, webhookSecret, autoAccept } = req.body;

      const update: Record<string, any> = {};
      if (enabled    !== undefined) update.enabled    = Boolean(enabled);
      if (storeId    !== undefined) update.storeId    = String(storeId);
      if (autoAccept !== undefined) update.autoAccept = Boolean(autoAccept);
      // Encrypt secrets only when a non-empty value is provided (write-only pattern)
      if (apiKey        && typeof apiKey        === 'string' && apiKey.trim())        update.apiKeyEnc        = encrypt(apiKey.trim());
      if (apiSecret     && typeof apiSecret     === 'string' && apiSecret.trim())     update.apiSecretEnc     = encrypt(apiSecret.trim());
      if (webhookSecret && typeof webhookSecret === 'string' && webhookSecret.trim()) update.webhookSecretEnc = encrypt(webhookSecret.trim());

      if (update.enabled === false) update.connectionStatus = 'disconnected';

      const integration = await AggregatorIntegration.findOneAndUpdate(
        { hotelId, platform },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      logAudit(req, 'aggregator.integration.update', 'AggregatorIntegration', integration._id.toString(), { platform, fields: Object.keys(update) });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayOrderCount = await Order.countDocuments({ hotelId, orderSource: platform, createdAt: { $gte: today } });
      res.json({ integration: safeIntegration(integration, { todayOrderCount }) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/integrations/:platform/disconnect
router.post(
  '/integrations/:platform/disconnect',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
      }
      const hotelId = req.hotelId!;

      const integration = await AggregatorIntegration.findOneAndUpdate(
        { hotelId, platform },
        { $set: { enabled: false, connectionStatus: 'disconnected' } },
        { new: true },
      );
      if (!integration) return res.status(404).json({ message: 'Integration not found' });

      logAudit(req, 'aggregator.integration.disconnect', 'AggregatorIntegration', integration._id.toString(), { platform });
      res.json({ success: true, integration: safeIntegration(integration) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/integrations/:platform/sync-menu — trigger menu sync
router.post(
  '/integrations/:platform/sync-menu',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
      }
      const hotelId = req.hotelId!;

      // Load all active products and their categories
      const [categories, products] = await Promise.all([
        Category.find({ hotelId, isDeleted: { $ne: true } }).lean(),
        Product.find({ hotelId, isDeleted: false }).lean(),
      ]);

      const result = await AggregatorService.syncMenu(hotelId, platform as AggregatorPlatform, categories, products, {
        triggeredBy:      'manual',
        triggeredByUserId: (req as any).userId ?? undefined,
        syncType:         'full',
      });
      logAudit(req, 'aggregator.menu.sync', 'AggregatorIntegration', '', { platform, syncedCount: result.syncedCount, failedCount: result.failedCount });
      res.json({ success: result.success, result });
    } catch (err: any) {
      console.error('[aggregatorRoutes] sync-menu error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// GET /api/aggregator/integrations/:platform/sync-status
router.get(
  '/integrations/:platform/sync-status',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
      }
      const hotelId = req.hotelId!;
      const integration = await AggregatorIntegration.findOne({ hotelId, platform })
        .select('menuSyncStatus lastSyncAt lastSyncError syncedItemCount failedItemCount connectionStatus lastOrderAt');
      if (!integration) return res.status(404).json({ message: 'Integration not found' });
      res.json({ status: integration });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/integrations/:platform/test — verify credentials
router.post(
  '/integrations/:platform/test',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform` });
      }
      const hotelId = req.hotelId!;

      const raw = await AggregatorIntegration.findOne({ hotelId, platform });
      if (!raw) {
        return res.status(404).json({ message: 'Integration not found. Save settings first.' });
      }

      if (!raw.apiKeyEnc) {
        const updated = await AggregatorIntegration.findByIdAndUpdate(
          raw._id,
          { lastTestAt: new Date(), lastTestSuccess: false, lastTestMessage: 'API key not configured' },
          { new: true },
        );
        return res.json({
          success: false,
          message: 'API key not configured. Save your credentials first.',
          integration: safeIntegration(updated!),
        });
      }

      if (process.env.AGGREGATOR_EXTERNAL_ENABLED !== 'true') {
        const updated = await AggregatorIntegration.findByIdAndUpdate(
          raw._id,
          { lastTestAt: new Date(), lastTestSuccess: null, lastTestMessage: 'Credentials configured — external activation pending' },
          { new: true },
        );
        return res.json({
          success: null,
          message: 'Credentials are configured. External API calls are disabled (AGGREGATOR_EXTERNAL_ENABLED=false). ' +
                   'Set to true and configure real Swiggy/Zomato Partner API access to run a live test.',
          integration: safeIntegration(updated!),
        });
      }

      // Live test — attempt a lightweight authenticated call
      const apiKey   = decrypt(raw.apiKeyEnc);
      const testUrl     = platform === 'swiggy'
        ? 'https://partner.swiggy.com/api/v2/ping'
        : 'https://api.zomato.com/business/v1/ping';
      const authHeaders: Record<string, string> = platform === 'swiggy'
        ? { 'Authorization': `Bearer ${apiKey}` }
        : { 'apikey': apiKey };

      let testSuccess = false;
      let testMessage = '';
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(testUrl, { signal: controller.signal, headers: authHeaders });
        clearTimeout(tid);
        // 200 = OK; 401/403 = reachable but wrong creds (still proves API is reachable)
        testSuccess = r.ok || r.status === 401 || r.status === 403;
        testMessage = testSuccess
          ? `API reachable (HTTP ${r.status})`
          : `API returned unexpected status ${r.status}`;
      } catch (err) {
        const e = err as Error;
        testMessage = e.name === 'AbortError' ? 'Request timed out (8s)' : e.message.slice(0, 200);
      }

      const updated = await AggregatorIntegration.findByIdAndUpdate(
        raw._id,
        {
          lastTestAt:       new Date(),
          lastTestSuccess:  testSuccess,
          lastTestMessage:  testMessage,
          connectionStatus: testSuccess ? 'connected' : 'error',
        },
        { new: true },
      );

      logAudit(req, 'aggregator.integration.test', 'AggregatorIntegration', raw._id.toString(), { platform, success: testSuccess });
      res.json({ success: testSuccess, message: testMessage, integration: safeIntegration(updated!) });
    } catch (err: any) {
      console.error('[aggregatorRoutes] integration test error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER MANAGEMENT — protected: authMiddleware + requireCashierOrAdmin
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/aggregator/orders — list online orders
router.get(
  '/orders',
  authMiddleware,
  requireCashierOrAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const { status, date, platform, page = '1', limit: limitStr = '50' } = req.query as Record<string, string>;

      const query: Record<string, any> = {
        hotelId,
        orderSource: { $in: platform ? [platform] : ['swiggy', 'zomato'] },
      };

      if (status) query.status = status;

      if (date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        query.createdAt = { $gte: start, $lte: end };
      }

      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 50));
      const skip     = (pageNum - 1) * pageSize;

      const [orders, total] = await Promise.all([
        Order.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        Order.countDocuments(query),
      ]);

      res.json({ orders, total, page: pageNum, pages: Math.ceil(total / pageSize) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/orders/:orderId/accept
router.post(
  '/orders/:orderId/accept',
  authMiddleware,
  requireCashierOrAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId     = req.hotelId!;
      const { orderId } = req.params;
      const prepMin     = Number(req.body.prepMin) || 20;

      const order = await Order.findOne({ _id: orderId, hotelId });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (!['swiggy', 'zomato'].includes(order.orderSource)) {
        return res.status(400).json({ message: 'Not a delivery platform order' });
      }
      if (order.status !== 'pending') {
        return res.status(400).json({ message: `Cannot accept order in '${order.status}' state` });
      }

      await order.updateOne({ acceptedAt: new Date(), status: 'preparing' });

      if (order.platformOrderId) {
        await AggregatorService.acceptOrder(
          hotelId,
          order.orderSource as AggregatorPlatform,
          order.platformOrderId,
          prepMin,
        );
      }

      io.to(`hotel_${hotelId}`).emit('order_accepted', {
        _id:         order._id,
        orderNumber: order.orderNumber,
        platform:    order.orderSource,
      });

      void notifyDelivery(hotelId, 'accepted', {
        customerPhone: (order as any).customerPhone,
        orderNumber:   order.orderNumber,
        orderSource:   order.orderSource,
      });

      logAudit(req, 'aggregator.order.accept', 'Order', orderId, { platform: order.orderSource, prepMin });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[aggregatorRoutes] order accept error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/orders/:orderId/reject
router.post(
  '/orders/:orderId/reject',
  authMiddleware,
  requireCashierOrAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId     = req.hotelId!;
      const { orderId } = req.params;
      const reason      = String(req.body.reason || 'Rejected by restaurant');

      const order = await Order.findOne({ _id: orderId, hotelId });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (!['swiggy', 'zomato'].includes(order.orderSource)) {
        return res.status(400).json({ message: 'Not a delivery platform order' });
      }
      if (!['pending', 'preparing'].includes(order.status)) {
        return res.status(400).json({ message: `Cannot reject order in '${order.status}' state` });
      }

      await order.updateOne({
        rejectedAt:      new Date(),
        rejectionReason: reason,
        status:          'cancelled',
      });

      if (order.platformOrderId) {
        await AggregatorService.rejectOrder(
          hotelId,
          order.orderSource as AggregatorPlatform,
          order.platformOrderId,
          reason,
        );
      }

      io.to(`hotel_${hotelId}`).emit('order_rejected', {
        _id:         order._id,
        orderNumber: order.orderNumber,
        platform:    order.orderSource,
        reason,
      });

      logAudit(req, 'aggregator.order.reject', 'Order', orderId, { platform: order.orderSource, reason });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[aggregatorRoutes] order reject error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/orders/:orderId/ready  (preparing → ready)
router.post(
  '/orders/:orderId/ready',
  authMiddleware,
  requireCashierOrAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId     = req.hotelId!;
      const { orderId } = req.params;

      const order = await Order.findOne({ _id: orderId, hotelId });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (!['swiggy', 'zomato'].includes(order.orderSource)) {
        return res.status(400).json({ message: 'Not a delivery platform order' });
      }
      if (order.status !== 'preparing') {
        return res.status(400).json({ message: `Cannot mark ready from '${order.status}' state` });
      }

      await order.updateOne({ status: 'ready' });

      if (order.platformOrderId) {
        try {
          await AggregatorService.markReady(
            hotelId,
            order.orderSource as AggregatorPlatform,
            order.platformOrderId,
          );
        } catch (err) {
          console.error('[aggregatorRoutes] markReady external call failed (non-fatal):', err);
        }
      }

      io.to(`hotel_${hotelId}`).emit('order_status_change', {
        _id:     order._id,
        status:  'ready',
        platform: order.orderSource,
      });

      void notifyDelivery(hotelId, 'ready', {
        customerPhone: (order as any).customerPhone,
        orderNumber:   order.orderNumber,
        orderSource:   order.orderSource,
      });

      logAudit(req, 'aggregator.order.ready', 'Order', orderId, { platform: order.orderSource });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[aggregatorRoutes] order ready error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/orders/:orderId/dispatch  (ready → completed)
router.post(
  '/orders/:orderId/dispatch',
  authMiddleware,
  requireCashierOrAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId     = req.hotelId!;
      const { orderId } = req.params;

      const order = await Order.findOne({ _id: orderId, hotelId });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (!['swiggy', 'zomato'].includes(order.orderSource)) {
        return res.status(400).json({ message: 'Not a delivery platform order' });
      }
      if (order.status !== 'ready') {
        return res.status(400).json({ message: `Cannot dispatch from '${order.status}' state. Mark order ready first.` });
      }

      await order.updateOne({ status: 'completed' });

      if (order.platformOrderId) {
        await AggregatorService.markDispatched(
          hotelId,
          order.orderSource as AggregatorPlatform,
          order.platformOrderId,
        );
      }

      io.to(`hotel_${hotelId}`).emit('order_dispatched', {
        _id:         order._id,
        orderNumber: order.orderNumber,
        platform:    order.orderSource,
      });

      void notifyDelivery(hotelId, 'completed', {
        customerPhone: (order as any).customerPhone,
        orderNumber:   order.orderNumber,
        orderSource:   order.orderSource,
      });

      logAudit(req, 'aggregator.order.dispatch', 'Order', orderId, { platform: order.orderSource });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[aggregatorRoutes] order dispatch error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK LOGS — protected: authMiddleware + requireAdmin
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/aggregator/webhook-logs
router.get(
  '/webhook-logs',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const { platform, status, search, page = '1', limit: limitStr = '50' } = req.query as Record<string, string>;

      const query: Record<string, any> = { hotelId };
      if (platform) query.platform = platform;
      if (status)   query.status   = status;
      if (search)   query.$or = [
        { platformOrderId: { $regex: search, $options: 'i' } },
        { event:           { $regex: search, $options: 'i' } },
      ];

      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 50));
      const skip     = (pageNum - 1) * pageSize;

      const [logs, total] = await Promise.all([
        WebhookLog.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .select('-rawBody') // omit raw body from list view
          .lean(),
        WebhookLog.countDocuments(query),
      ]);

      res.json({ logs, total, page: pageNum, pages: Math.ceil(total / pageSize) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/webhook-logs/:id/retry — re-process a failed webhook log
router.post(
  '/webhook-logs/:id/retry',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const { id }  = req.params;

      const log = await WebhookLog.findOne({ _id: id, hotelId });
      if (!log) return res.status(404).json({ message: 'Webhook log not found' });
      if (log.status === 'success') return res.status(400).json({ message: 'Webhook already succeeded — no retry needed' });
      if (!log.rawBody) return res.status(400).json({ message: 'No raw body stored — cannot retry' });

      const platform = log.platform as AggregatorPlatform;
      if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({ message: 'Cannot retry generic platform webhooks' });
      }

      await WebhookLog.findByIdAndUpdate(id, {
        $inc: { retryCount: 1 },
        status: 'retrying',
      });

      const headers: Record<string, string> = {};
      if (log.headers && typeof log.headers === 'object') {
        for (const [k, v] of Object.entries(log.headers as Record<string, unknown>)) {
          if (typeof v === 'string') headers[k] = v;
        }
      }

      const result = await processAggregatorWebhook(platform, log.rawBody, headers);

      if (result.error) {
        await WebhookLog.findByIdAndUpdate(id, {
          status:       'failed',
          errorMessage: result.error,
          nextRetryAt:  null,
        });
        return res.status(200).json({ success: false, error: result.error });
      }

      await WebhookLog.findByIdAndUpdate(id, {
        status:          'success',
        errorMessage:    null,
        orderId:         result.orderId || null,
        platformOrderId: result.platformOrderId || '',
        nextRetryAt:     null,
      });

      logAudit(req, 'aggregator.webhook.retry', 'WebhookLog', id, { platform, orderId: result.orderId });
      res.json({ success: true, orderId: result.orderId });
    } catch (err: any) {
      console.error('[aggregatorRoutes] webhook retry error:', err);
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-SYNC CONFIG — PUT /api/aggregator/integrations/:platform/auto-sync
// ═══════════════════════════════════════════════════════════════════════════════

router.put(
  '/integrations/:platform/auto-sync',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { platform } = req.params;
      if (!PLATFORMS.includes(platform as AggregatorPlatform)) {
        return res.status(400).json({ message: `Invalid platform` });
      }
      const hotelId = req.hotelId!;
      const { enabled, intervalMinutes } = req.body as { enabled?: boolean; intervalMinutes?: number };

      const VALID_INTERVALS = [15, 30, 60, 1440];
      if (intervalMinutes !== undefined && !VALID_INTERVALS.includes(intervalMinutes)) {
        return res.status(400).json({ message: `intervalMinutes must be one of: ${VALID_INTERVALS.join(', ')}` });
      }

      const update: Record<string, unknown> = {};
      if (typeof enabled === 'boolean')            update.autoSyncEnabled         = enabled;
      if (typeof intervalMinutes === 'number')     update.autoSyncIntervalMinutes = intervalMinutes;

      // When enabling auto-sync, compute the first nextAutoSyncAt if not already set
      if (enabled === true) {
        const existing = await AggregatorIntegration.findOne({ hotelId, platform });
        if (!existing?.nextAutoSyncAt) {
          const mins = intervalMinutes ?? existing?.autoSyncIntervalMinutes ?? 60;
          update.nextAutoSyncAt = new Date(Date.now() + mins * 60_000);
        }
      }
      // When disabling, clear the scheduled time
      if (enabled === false) {
        update.nextAutoSyncAt = null;
      }

      const integration = await AggregatorIntegration.findOneAndUpdate(
        { hotelId, platform },
        { $set: update },
        { new: true, upsert: false },
      );
      if (!integration) return res.status(404).json({ message: 'Integration not found. Save settings first.' });

      logAudit(req, 'aggregator.auto_sync.config', 'AggregatorIntegration', integration._id.toString(), {
        platform, enabled, intervalMinutes,
      });
      res.json({ integration: safeIntegration(integration) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM AVAILABILITY — per-product channel availability overrides
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/aggregator/items — list products with channel availability for this hotel
router.get(
  '/items',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;

      const [products, categories] = await Promise.all([
        Product.find({ hotelId, isDeleted: false })
          .select('name price category isAvailable isVeg channelPrices channelAvailability platformIds')
          .sort({ name: 1 })
          .lean(),
        Category.find({ hotelId, isDeleted: { $ne: true } }).select('_id name').lean(),
      ]);

      const catMap = new Map<string, string>(
        categories.map((c: any) => [String(c._id), c.name as string]),
      );

      const result = products.map((p: any) => ({
        _id:                p._id,
        name:               p.name,
        price:              p.price,
        isAvailable:        p.isAvailable,
        isVeg:              p.isVeg,
        categoryId:         String(p.category),
        categoryName:       catMap.get(String(p.category)) ?? '',
        channelPrices:      p.channelPrices ?? {},
        channelAvailability: {
          swiggy: p.channelAvailability?.swiggy ?? null,
          zomato: p.channelAvailability?.zomato ?? null,
        },
        platformIds: {
          swiggy: p.platformIds?.swiggy ?? '',
          zomato: p.platformIds?.zomato ?? '',
        },
      }));

      res.json({ products: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// PUT /api/aggregator/items/:productId/availability
router.put(
  '/items/:productId/availability',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId   = req.hotelId!;
      const { productId } = req.params;
      const { platform, available } = req.body as {
        platform: 'swiggy' | 'zomato';
        available: boolean | null;
      };

      if (!['swiggy', 'zomato'].includes(platform)) {
        return res.status(400).json({ message: 'platform must be swiggy or zomato' });
      }
      if (available !== null && typeof available !== 'boolean') {
        return res.status(400).json({ message: 'available must be true, false, or null (inherit from POS)' });
      }

      const product = await Product.findOneAndUpdate(
        { _id: productId, hotelId, isDeleted: false },
        { $set: { [`channelAvailability.${platform}`]: available } },
        { new: true }
      ).select('name price isAvailable channelPrices channelAvailability platformIds category');

      if (!product) return res.status(404).json({ message: 'Product not found' });

      // If product has a platform ID, fire-and-forget availability update to the platform
      const platformItemId = (product.platformIds as any)?.[platform];
      if (platformItemId && process.env.AGGREGATOR_EXTERNAL_ENABLED === 'true') {
        const effectiveAvail = available !== null ? available : product.isAvailable;
        void AggregatorService.syncProductAvailability(hotelId, productId, platformItemId, effectiveAvail)
          .catch(err => console.error('[aggregatorRoutes] availability sync error:', err));
      }

      logAudit(req, 'aggregator.item.availability', 'Product', productId, {
        platform, available, productName: product.name,
      });

      res.json({
        product: {
          _id:         product._id,
          name:        product.name,
          price:       product.price,
          isAvailable: product.isAvailable,
          channelPrices:       (product.channelPrices as any) ?? {},
          channelAvailability: {
            swiggy: (product.channelAvailability as any)?.swiggy ?? null,
            zomato: (product.channelAvailability as any)?.zomato ?? null,
          },
          platformIds: {
            swiggy: (product.platformIds as any)?.swiggy ?? '',
            zomato: (product.platformIds as any)?.zomato ?? '',
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// POST /api/aggregator/items/bulk-availability
router.post(
  '/items/bulk-availability',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const { productIds, platform, available } = req.body as {
        productIds: string[];
        platform:   'swiggy' | 'zomato';
        available:  boolean | null;
      };

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ message: 'productIds must be a non-empty array' });
      }
      if (!['swiggy', 'zomato'].includes(platform)) {
        return res.status(400).json({ message: 'platform must be swiggy or zomato' });
      }
      if (available !== null && typeof available !== 'boolean') {
        return res.status(400).json({ message: 'available must be true, false, or null' });
      }
      if (productIds.length > 200) {
        return res.status(400).json({ message: 'Cannot bulk-update more than 200 products at once' });
      }

      const result = await Product.updateMany(
        { _id: { $in: productIds }, hotelId, isDeleted: false },
        { $set: { [`channelAvailability.${platform}`]: available } },
      );

      logAudit(req, 'aggregator.item.bulk_availability', 'Product', '', {
        platform, available, count: result.modifiedCount,
      });

      res.json({ updated: result.modifiedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/aggregator/sync-history
router.get(
  '/sync-history',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const {
        platform, status, syncType,
        from, to,
        page = '1', limit: limitStr = '25',
      } = req.query as Record<string, string>;

      const query: Record<string, any> = { hotelId };
      if (platform && ['swiggy', 'zomato'].includes(platform)) query.platform = platform;
      if (status)   query.status   = status;
      if (syncType) query.syncType = syncType;

      if (from || to) {
        query.startedAt = {};
        if (from) query.startedAt.$gte = new Date(from + 'T00:00:00.000Z');
        if (to)   query.startedAt.$lte = new Date(to   + 'T23:59:59.999Z');
      }

      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 25));
      const skip     = (pageNum - 1) * pageSize;

      const [records, total] = await Promise.all([
        MenuSyncHistory.find(query)
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .select('-failureSummary')   // omit detail array from list view
          .lean(),
        MenuSyncHistory.countDocuments(query),
      ]);

      res.json({
        records,
        total,
        page:  pageNum,
        pages: Math.ceil(total / pageSize),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// GET /api/aggregator/sync-history/:id — full detail including failureSummary
router.get(
  '/sync-history/:id',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const record  = await MenuSyncHistory.findOne({ _id: req.params.id, hotelId }).lean();
      if (!record) return res.status(404).json({ message: 'Sync history record not found' });
      res.json({ record });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// RECONCILIATION — internal summary (no external settlement API)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/aggregator/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=swiggy|zomato
router.get(
  '/reconciliation',
  authMiddleware,
  requireAdmin,
  requireFeature('aggregator'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hotelId = req.hotelId!;
      const { from, to, platform } = req.query as Record<string, string>;

      if (!from || !to) {
        return res.status(400).json({ message: 'from and to date parameters are required (YYYY-MM-DD)' });
      }

      const fromDate = new Date(from + 'T00:00:00.000+05:30');
      const toDate   = new Date(to   + 'T23:59:59.999+05:30');

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const query: Record<string, any> = {
        hotelId,
        orderSource: { $in: ['swiggy', 'zomato'] },
        createdAt:   { $gte: fromDate, $lte: toDate },
      };
      if (platform && ['swiggy', 'zomato'].includes(platform)) {
        query.orderSource = platform;
      }

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .select('orderNumber orderSource platformOrderId status grandTotal subtotal taxTotal deliveryFee discountAmount platformCommission customerName createdAt acceptedAt')
        .lean();

      const summary: Record<string, { count: number; gross: number; commission: number; net: number }> = {
        swiggy: { count: 0, gross: 0, commission: 0, net: 0 },
        zomato: { count: 0, gross: 0, commission: 0, net: 0 },
      };

      for (const o of orders as any[]) {
        const p = o.orderSource as string;
        if (!summary[p]) summary[p] = { count: 0, gross: 0, commission: 0, net: 0 };
        const commission = o.platformCommission ?? 0;
        summary[p].count++;
        summary[p].gross      += o.grandTotal ?? 0;
        summary[p].commission += commission;
        summary[p].net        += (o.grandTotal ?? 0) - commission;
      }

      res.json({ orders, summary, from, to });
    } catch (err: any) {
      res.status(500).json({ message: err.message || 'Server error' });
    }
  },
);

export default router;
