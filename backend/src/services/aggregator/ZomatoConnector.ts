import crypto from 'crypto';
import { BaseConnector } from './BaseConnector';
import type { IAggregatorIntegration } from '../../models/AggregatorIntegration';
import type { ParsedAggregatorOrder, MenuSyncResult } from './types';

const BASE_URL = 'https://api.zomato.com/business/v1';

export class ZomatoConnector extends BaseConnector {
  readonly platform = 'zomato';

  // ── Webhook signature verification ─────────────────────────────────────────
  // Header: x-zomato-signature: sha256=<hex>
  // Falls back to shared AGGREGATOR_SECRET if integration.webhookSecret is not configured.
  verifyWebhookSignature(
    rawBody:     string,
    headers:     Record<string, string>,
    integration: IAggregatorIntegration,
  ): boolean {
    const secret = integration.webhookSecret || process.env.AGGREGATOR_SECRET || '';
    if (!secret) return false;

    const sigHeader = headers['x-zomato-signature'] || '';
    // Expected format: "sha256=<hex>"
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
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  // ── Parse incoming Zomato order ────────────────────────────────────────────
  // Zomato webhook payload fields:
  //   order_id, res_id, customer.name, customer.contact,
  //   delivery_address.address, order_items[].name/.quantity/.price/.menu_item_id,
  //   order_amount, delivery_charge, order_tax, total_amount,
  //   payment_type ('prepaid'/'cod'), pickup_time, order_instructions
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
      estimatedPickupTime: data.pickup_time ? String(data.pickup_time) : undefined,
      notes:               String(data.order_instructions || data.order_notes || ''),
    };
  }

  // ── Accept order ────────────────────────────────────────────────────────────
  async acceptOrder(
    integration:           IAggregatorIntegration,
    platformOrderId:       string,
    estimatedPrepMinutes = 20,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('acceptOrder', { platformOrderId, estimatedPrepMinutes, storeId: integration.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
      body: JSON.stringify({ status: 'Accepted', prep_time: estimatedPrepMinutes }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato acceptOrder failed [${res.status}]: ${text}`);
    }
  }

  // ── Reject order ────────────────────────────────────────────────────────────
  async rejectOrder(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
    reason:          string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('rejectOrder', { platformOrderId, reason, storeId: integration.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
      body: JSON.stringify({ status: 'Rejected', rejection_reason: reason }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato rejectOrder failed [${res.status}]: ${text}`);
    }
  }

  // ── Mark ready ──────────────────────────────────────────────────────────────
  async markReady(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('markReady', { platformOrderId, storeId: integration.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
      body: JSON.stringify({ status: 'Ready' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato markReady failed [${res.status}]: ${text}`);
    }
  }

  // ── Mark dispatched ─────────────────────────────────────────────────────────
  async markDispatched(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('markDispatched', { platformOrderId, storeId: integration.storeId });
      return;
    }

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
      body: JSON.stringify({ status: 'Dispatched' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato markDispatched failed [${res.status}]: ${text}`);
    }
  }

  // ── Sync menu ───────────────────────────────────────────────────────────────
  async syncMenu(
    integration: IAggregatorIntegration,
    categories:  unknown[],
    products:    unknown[],
  ): Promise<MenuSyncResult> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('syncMenu', {
        storeId:       integration.storeId,
        categoryCount: (categories as any[]).length,
        productCount:  (products as any[]).length,
      });
      return {
        success:      true,
        syncedCount:  (products as any[]).length,
        failedCount:  0,
        failedItems:  [],
      };
    }

    // Build Zomato menu format
    const menu = {
      res_id: integration.storeId,
      categories: (categories as any[]).map(cat => ({
        name:  cat.name,
        items: (products as any[])
          .filter((p: any) => String(p.category) === String(cat._id))
          .map((p: any) => ({
            name:         p.name,
            price:        p.channelPrices?.zomato ?? p.price,
            description:  p.description || '',
            is_veg:       p.isVeg ? 1 : 0,
            availability: p.isAvailable && !p.isDeleted ? 1 : 0,
            menu_item_id: p.platformIds?.zomato || undefined,
          })),
      })),
    };

    const res = await fetch(`${BASE_URL}/menu/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
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
    integration:    IAggregatorIntegration,
    platformItemId: string,
    available:      boolean,
  ): Promise<void> {
    if (!this.externalEnabled()) {
      this.logExternalSkip('updateProductAvailability', {
        platformItemId,
        available,
        storeId: integration.storeId,
      });
      return;
    }

    const res = await fetch(`${BASE_URL}/menu/items/${platformItemId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       integration.apiKey,
      },
      body: JSON.stringify({ availability: available ? 1 : 0 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zomato updateProductAvailability failed [${res.status}]: ${text}`);
    }
  }
}
