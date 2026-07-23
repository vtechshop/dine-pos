import crypto from 'crypto';
import { BaseConnector } from './BaseConnector';
import type { IAggregatorIntegration } from '../../models/AggregatorIntegration';
import type { ParsedAggregatorOrder, MenuSyncResult } from './types';

const BASE_URL = 'https://partner.swiggy.com/api/v2';

export class SwiggyConnector extends BaseConnector {
  readonly platform = 'swiggy';

  // ── Webhook signature verification ─────────────────────────────────────────
  // Header: x-swiggy-signature: sha256=<hex>
  // Falls back to shared AGGREGATOR_SECRET if integration.webhookSecret is not configured.
  verifyWebhookSignature(
    rawBody:     string,
    headers:     Record<string, string>,
    integration: IAggregatorIntegration,
  ): boolean {
    const secret = integration.webhookSecret || process.env.AGGREGATOR_SECRET || '';
    if (!secret) return false;

    const sigHeader = headers['x-swiggy-signature'] || '';
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

  // ── Parse incoming Swiggy order ────────────────────────────────────────────
  // Swiggy webhook payload fields:
  //   order_id, restaurant_id, customer.name, customer.mobile,
  //   delivery_address.full_address, order_items[].name/.quantity/.price/.catalog_id,
  //   order_total, delivery_fee, vat_amount, payable_amount,
  //   payment_method, sla_time, special_instructions
  parseIncomingOrder(rawBody: string): ParsedAggregatorOrder {
    const data = JSON.parse(rawBody);

    const items = (data.order_items || []).map((item: any) => ({
      productName:    String(item.name || item.item_name || 'Unknown Item'),
      quantity:       Number(item.quantity) || 1,
      price:          Number(item.price) || 0,
      taxPercent:     Number(item.tax_percent) || 0,
      notes:          item.customizations ? JSON.stringify(item.customizations) : undefined,
      platformItemId: String(item.catalog_id || item.item_id || ''),
    }));

    const subtotal = items.reduce(
      (sum: number, i: any) => sum + i.price * i.quantity,
      0,
    );

    const paymentMethod: 'prepaid' | 'cod' =
      String(data.payment_method || '').toLowerCase() === 'cod' ? 'cod' : 'prepaid';

    let event: 'new_order' | 'order_cancelled' | 'order_update' = 'new_order';
    const eventType = String(data.event_type || data.order_status || '').toLowerCase();
    if (eventType.includes('cancel')) event = 'order_cancelled';
    else if (eventType.includes('update')) event = 'order_update';

    return {
      platformOrderId:     String(data.order_id || ''),
      storeId:             String(data.restaurant_id || data.store_id || ''),
      event,
      customerName:        String(data.customer?.name || data.customer_name || 'Swiggy Customer'),
      customerPhone:       String(data.customer?.mobile || data.customer?.phone || ''),
      deliveryAddress:     String(
        data.delivery_address?.full_address ||
        data.delivery_address?.address ||
        data.delivery_address ||
        '',
      ),
      items,
      subtotal,
      deliveryFee:         Number(data.delivery_fee) || 0,
      taxTotal:            Number(data.vat_amount || data.tax_amount) || 0,
      grandTotal:          Number(data.payable_amount || data.order_total) || subtotal,
      paymentMethod,
      estimatedPickupTime: data.sla_time ? String(data.sla_time) : undefined,
      notes:               String(data.special_instructions || data.order_notes || ''),
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

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
      body: JSON.stringify({ prep_time: estimatedPrepMinutes }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy acceptOrder failed [${res.status}]: ${text}`);
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

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy rejectOrder failed [${res.status}]: ${text}`);
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

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/ready`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy markReady failed [${res.status}]: ${text}`);
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

    const res = await fetch(`${BASE_URL}/orders/${platformOrderId}/dispatched`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy markDispatched failed [${res.status}]: ${text}`);
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

    // Build Swiggy catalog format
    const catalog = {
      restaurant_id: integration.storeId,
      categories: (categories as any[]).map(cat => ({
        name:  cat.name,
        items: (products as any[])
          .filter((p: any) => String(p.category) === String(cat._id))
          .map((p: any) => ({
            name:        p.name,
            price:       p.channelPrices?.swiggy ?? p.price,
            description: p.description || '',
            is_veg:      p.isVeg ? 1 : 0,
            in_stock:    p.isAvailable && !p.isDeleted ? 1 : 0,
            catalog_id:  p.platformIds?.swiggy || undefined,
          })),
      })),
    };

    const res = await fetch(`${BASE_URL}/catalog/upload`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
      body: JSON.stringify(catalog),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy syncMenu failed [${res.status}]: ${text}`);
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

    const res = await fetch(`${BASE_URL}/catalog/items/${platformItemId}/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${integration.apiKey}`,
      },
      body: JSON.stringify({ in_stock: available }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Swiggy updateProductAvailability failed [${res.status}]: ${text}`);
    }
  }
}
