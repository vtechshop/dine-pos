import crypto from 'crypto';
import { BaseConnector } from './BaseConnector';
import type { ParsedAggregatorOrder, MenuSyncResult, ConnectorContext } from './types';

const BASE_URL = 'https://api.zomato.com/business/v1';

function zomatoAvailable(p: Record<string, unknown>): 0 | 1 {
  const override = (p.channelAvailability as Record<string, boolean | null> | undefined)?.zomato;
  if (override === null || override === undefined) {
    return (p.isAvailable && !p.isDeleted) ? 1 : 0;
  }
  return (override && !p.isDeleted) ? 1 : 0;
}

export class ZomatoConnector extends BaseConnector {
  readonly platform = 'zomato';

  // ── Webhook signature verification ─────────────────────────────────────────
  // Header: x-zomato-signature: sha256=<hex>
  verifyWebhookSignature(
    rawBody:       string,
    headers:       Record<string, string>,
    webhookSecret: string,
  ): boolean {
    const secret = webhookSecret || process.env.AGGREGATOR_SECRET || '';
    if (!secret) return false;

    const sigHeader   = headers['x-zomato-signature'] || '';
    const incomingHex = sigHeader.startsWith('sha256=')
      ? sigHeader.slice('sha256='.length)
      : sigHeader;

    if (!incomingHex) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(incomingHex, 'hex'),
        Buffer.from(expected,    'hex'),
      );
    } catch {
      return false;
    }
  }

  // ── Parse incoming Zomato order ────────────────────────────────────────────
  parseIncomingOrder(rawBody: string): ParsedAggregatorOrder {
    const data = JSON.parse(rawBody);

    const items = (data.order_items || []).map((item: any) => ({
      productName:    String(item.name || item.item_name || 'Unknown Item'),
      quantity:       Number(item.quantity) || 1,
      price:          Number(item.price) || 0,
      taxPercent:     Number(item.tax_percent) || 0,
      notes:          item.customizations ? JSON.stringify(item.customizations) : undefined,
      platformItemId: String(item.menu_item_id || item.item_id || ''),
    }));

    const subtotal = items.reduce(
      (sum: number, i: any) => sum + i.price * i.quantity,
      0,
    );

    const rawPayment = String(data.payment_type || data.payment_method || '').toLowerCase();
    const paymentMethod: 'prepaid' | 'cod' = rawPayment === 'cod' ? 'cod' : 'prepaid';

    let event: 'new_order' | 'order_cancelled' | 'order_update' = 'new_order';
    const eventType = String(data.event_type || data.order_status || '').toLowerCase();
    if (eventType.includes('cancel')) event = 'order_cancelled';
    else if (eventType.includes('update')) event = 'order_update';

    return {
      platformOrderId:     String(data.order_id || ''),
      storeId:             String(data.res_id || data.restaurant_id || data.store_id || ''),
      event,
      customerName:        String(data.customer?.name || data.customer_name || 'Zomato Customer'),
      customerPhone:       String(data.customer?.contact || data.customer?.phone || data.customer?.mobile || ''),
      deliveryAddress:     String(
        data.delivery_address?.address ||
        data.delivery_address?.full_address ||
        data.delivery_address ||
        '',
      ),
      items,
      subtotal,
      deliveryFee:         Number(data.delivery_charge || data.delivery_fee) || 0,
      taxTotal:            Number(data.order_tax || data.tax_amount) || 0,
      grandTotal:          Number(data.total_amount || data.order_amount) || subtotal,
      paymentMethod,
      estimatedPickupTime: (() => {
        if (!data.pickup_time) return undefined;
        const raw    = String(data.pickup_time);
        const asDate = new Date(raw);
        if (!isNaN(asDate.getTime())) return asDate.toISOString();
        const mins = parseInt(raw, 10);
        if (!isNaN(mins) && mins > 0) return new Date(Date.now() + mins * 60_000).toISOString();
        return undefined;
      })(),
      notes: String(data.order_instructions || data.order_notes || ''),
    };
  }

  // ── Accept order ────────────────────────────────────────────────────────────
  async acceptOrder(
    ctx:                   ConnectorContext,
    platformOrderId:       string,
    estimatedPrepMinutes = 20,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('acceptOrder', { platformOrderId, estimatedPrepMinutes, storeId: ctx.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify({ status: 'Accepted', prep_time: estimatedPrepMinutes }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato acceptOrder failed [${res.status}]: ${text}`);
    }
  }

  // ── Reject order ────────────────────────────────────────────────────────────
  async rejectOrder(
    ctx:             ConnectorContext,
    platformOrderId: string,
    reason:          string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('rejectOrder', { platformOrderId, reason, storeId: ctx.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify({ status: 'Rejected', rejection_reason: reason }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato rejectOrder failed [${res.status}]: ${text}`);
    }
  }

  // ── Mark ready ──────────────────────────────────────────────────────────────
  async markReady(
    ctx:             ConnectorContext,
    platformOrderId: string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('markReady', { platformOrderId, storeId: ctx.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify({ status: 'Ready' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato markReady failed [${res.status}]: ${text}`);
    }
  }

  // ── Mark dispatched ─────────────────────────────────────────────────────────
  async markDispatched(
    ctx:             ConnectorContext,
    platformOrderId: string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('markDispatched', { platformOrderId, storeId: ctx.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify({ status: 'Dispatched' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato markDispatched failed [${res.status}]: ${text}`);
    }
  }

  // ── Sync menu ───────────────────────────────────────────────────────────────
  async syncMenu(
    ctx:        ConnectorContext,
    categories: unknown[],
    products:   unknown[],
  ): Promise<MenuSyncResult> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('syncMenu', {
        storeId:       ctx.storeId,
        categoryCount: (categories as any[]).length,
        productCount:  (products as any[]).length,
      });
      return { success: true, syncedCount: (products as any[]).length, failedCount: 0, failedItems: [] };
    }

    const menu = {
      res_id:     ctx.storeId,
      categories: (categories as any[]).map(cat => ({
        name:  cat.name,
        items: (products as any[])
          .filter((p: any) => String(p.category) === String(cat._id))
          .map((p: any) => ({
            name:         p.name,
            price:        p.channelPrices?.zomato ?? p.price,
            description:  p.description || '',
            is_veg:       p.isVeg ? 1 : 0,
            availability: zomatoAvailable(p),
            menu_item_id: p.platformIds?.zomato || undefined,
          })),
      })),
    };

    const res = await fetch(`${BASE_URL}/menu/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify(menu),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato syncMenu failed [${res.status}]: ${text}`);
    }

    const result = await res.json().catch(() => ({})) as any;
    const failedItems: { name: string; error: string }[] =
      (result.failed_items || []).map((fi: any) => ({
        name:  String(fi.name || fi.item_name || ''),
        error: String(fi.error || fi.reason || 'Unknown error'),
      }));

    const totalProducts = (products as any[]).length;
    const failedCount   = failedItems.length;

    return {
      success:     failedCount === 0,
      syncedCount: totalProducts - failedCount,
      failedCount,
      failedItems,
    };
  }

  // ── Update product availability ─────────────────────────────────────────────
  async updateProductAvailability(
    ctx:            ConnectorContext,
    platformItemId: string,
    available:      boolean,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('updateProductAvailability', { platformItemId, available, storeId: ctx.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/menu/items/${platformItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'apikey': ctx.apiKey },
      body: JSON.stringify({ availability: available ? 1 : 0 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato updateProductAvailability failed [${res.status}]: ${text}`);
    }
  }
}
