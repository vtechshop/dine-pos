import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { authMiddleware, requireAdmin, requireCashierOrAdmin, type AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import AggregatorIntegration from '../models/AggregatorIntegration';
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

const router = Router();

// ── Legacy: simple shared-secret guard ────────────────────────────────────────
const WEBHOOK_SECRET = process.env.AGGREGATOR_SECRET;
if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'agg-secret-changeme') {
  console.warn(
    'WARNING: AGGREGATOR_SECRET is not set or is using the default value. ' +
    'Set a strong secret in .env to prevent fake webhook orders.',
  );
}

const safeEqualSecret = (a: string, b: string): boolean => {
  try {
    return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
): Promise<{ hotelId?: string; orderId?: string; platformOrderId?: string; error?: string }> {
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
    const connector = AggregatorService.getConnector(platform);
    const valid     = connector.verifyWebhookSignature(rawBody, headers, integration);
    if (!valid) return { error: 'Invalid webhook signature' };
  } else if (!hotelId) {
    // New-style webhook with no matching integration — check shared secret fallback
    const sharedSecret = process.env.AGGREGATOR_SECRET;
    const incoming     = headers['x-webhook-secret'] || '';
    try {
      const { timingSafeEqual: tse } = await import('crypto');
      if (
        !sharedSecret ||
        !incoming ||
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

  // 6. Idempotency: check if platformOrderId already exists
  if (parsed.platformOrderId) {
    const existing = await Order.findOne({ hotelId, platformOrderId: parsed.platformOrderId });
    if (existing) {
      return { hotelId, orderId: existing._id.toString(), platformOrderId: parsed.platformOrderId };
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
      await Order.findByIdAndUpdate(order._id, { acceptedAt: new Date() });
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
    _id:         order._id,
    orderNumber: order.orderNumber,
    platform,
    customerName:order.customerName,
    grandTotal:  order.grandTotal,
  });

  return { hotelId, orderId: order._id.toString(), platformOrderId: parsed.platformOrderId };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS — keep existing URLs working
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/aggregator/order — generic webhook (old path)
router.post('/order', async (req: Request, res: Response) => {
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!WEBHOOK_SECRET || !incomingSecret || !safeEqualSecret(incomingSecret, WEBHOOK_SECRET)) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook secret' });
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
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!WEBHOOK_SECRET || !incomingSecret || !safeEqualSecret(incomingSecret, WEBHOOK_SECRET)) {
    return res.status(401).json({ message: 'Unauthorized' });
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
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!WEBHOOK_SECRET || !incomingSecret || !safeEqualSecret(incomingSecret, WEBHOOK_SECRET)) {
    return res.status(401).json({ message: 'Unauthorized' });
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
router.post('/webhook/swiggy', async (req: Request, res: Response) => {
  const rawBody = typeof (req as any).rawBody === 'string'
    ? (req as any).rawBody
    : JSON.stringify(req.body);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
  }

  // Log receipt immediately (before processing, so we record even failures)
  const logEntry = new WebhookLog({
    platform:        'swiggy',
    event:           'new_order',
    rawBody:         rawBody.slice(0, 20000),
    headers:         { 'x-swiggy-signature': headers['x-swiggy-signature'] || '' },
    status:          'retrying',
    platformOrderId: '',
  });

  try {
    const result = await processAggregatorWebhook('swiggy', rawBody, headers);

    if (result.error) {
      logEntry.status       = 'failed';
      logEntry.errorMessage = result.error;
      await logEntry.save().catch(() => {});
      // Return 200 to prevent Swiggy retrying on auth/config errors
      return res.status(200).json({ success: false, error: result.error });
    }

    logEntry.status          = 'success';
    logEntry.orderId         = result.orderId ? (result.orderId as any) : null;
    logEntry.platformOrderId = result.platformOrderId || '';
    logEntry.hotelId         = result.hotelId ? (result.hotelId as any) : null;
    await logEntry.save().catch(() => {});

    return res.status(200).json({ success: true, orderId: result.orderId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aggregatorRoutes] /webhook/swiggy unhandled error:', err);
    logEntry.status       = 'failed';
    logEntry.errorMessage = msg;
    await logEntry.save().catch(() => {});
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/aggregator/webhook/zomato
router.post('/webhook/zomato', async (req: Request, res: Response) => {
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

  try {
    const result = await processAggregatorWebhook('zomato', rawBody, headers);

    if (result.error) {
      logEntry.status       = 'failed';
      logEntry.errorMessage = result.error;
      await logEntry.save().catch(() => {});
      return res.status(200).json({ success: false, error: result.error });
    }

    logEntry.status          = 'success';
    logEntry.orderId         = result.orderId ? (result.orderId as any) : null;
    logEntry.platformOrderId = result.platformOrderId || '';
    logEntry.hotelId         = result.hotelId ? (result.hotelId as any) : null;
    await logEntry.save().catch(() => {});

    return res.status(200).json({ success: true, orderId: result.orderId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aggregatorRoutes] /webhook/zomato unhandled error:', err);
    logEntry.status       = 'failed';
    logEntry.errorMessage = msg;
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
      const integrations = await Promise.all(
        PLATFORMS.map(async platform => {
          let integration = await AggregatorIntegration.findOne({ hotelId, platform });
          if (!integration) {
            integration = await AggregatorIntegration.create({ hotelId, platform });
          }
          return integration;
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
      if (!integration) {
        integration = await AggregatorIntegration.create({ hotelId, platform });
      }
      res.json({ integration });
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

      // Only allow safe fields to be updated via API
      const {
        enabled, storeId, apiKey, apiSecret, webhookSecret, autoAccept,
      } = req.body;

      const update: Record<string, any> = {};
      if (enabled     !== undefined) update.enabled     = Boolean(enabled);
      if (storeId     !== undefined) update.storeId     = String(storeId);
      if (apiKey      !== undefined) update.apiKey      = String(apiKey);
      if (apiSecret   !== undefined) update.apiSecret   = String(apiSecret);
      if (webhookSecret !== undefined) update.webhookSecret = String(webhookSecret);
      if (autoAccept  !== undefined) update.autoAccept  = Boolean(autoAccept);

      // If credentials are cleared, reset connection status
      if (update.apiKey === '' || update.enabled === false) {
        update.connectionStatus = 'disconnected';
      }

      const integration = await AggregatorIntegration.findOneAndUpdate(
        { hotelId, platform },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      logAudit(req, 'aggregator.integration.update', 'AggregatorIntegration', integration._id.toString(), { platform, fields: Object.keys(update) });
      res.json({ integration });
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
      res.json({ success: true, integration });
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

      const result = await AggregatorService.syncMenu(hotelId, platform as AggregatorPlatform, categories, products);
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

// POST /api/aggregator/orders/:orderId/dispatch
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
      const { platform, status, page = '1', limit: limitStr = '50' } = req.query as Record<string, string>;

      const query: Record<string, any> = { hotelId };
      if (platform) query.platform = platform;
      if (status)   query.status   = status;

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

export default router;
